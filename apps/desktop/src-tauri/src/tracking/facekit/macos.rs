// The macOS FaceKit adapter (TRK-24 B33). AppleCVA is a private framework: the adapter loads it at
// run time with `dlopen` by its absolute path and resolves four C functions with `dlsym` (spec
// Appendix A). The build never links it. AVFoundation captures the camera, Vision finds the face
// rectangle, and FaceKit gives the blend shapes and the head rotation. No other module calls these
// APIs.
//
// Threads: `start` spawns one start thread for each run and returns at once. The start thread loads
// the library, checks the names, waits for the camera permission (the completion handler sends the
// answer to it), creates the tracker, and starts the capture session. AVFoundation calls the frame
// output on the serial queue of the run, which runs Vision and `Process`. FaceKit calls the result
// block on its own thread. A session error, a device disconnect, or an unexpected result stops the
// run on a global dispatch queue, never on a capture or FaceKit thread.
//
// Privacy: frames stay in this process. Only the rotation, the blend shapes, and `tongue_out` are
// copied out of a result. The log gets only the API version.
#![allow(non_snake_case)]
use super::adapter::*;
use super::mapping::{face_frame, names_match, BadShape};
use crate::tracking::lock;
use block2::RcBlock;
use dispatch2::{DispatchQoS, DispatchQueue, DispatchRetained, GlobalQueueIdentifier};
use objc2::rc::{autoreleasepool, Retained};
use objc2::runtime::{AnyObject, Bool, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass};
use objc2_av_foundation::{
    AVAuthorizationStatus, AVCaptureConnection, AVCaptureDevice, AVCaptureDeviceDiscoverySession,
    AVCaptureDeviceInput, AVCaptureDevicePosition, AVCaptureDeviceTypeBuiltInWideAngleCamera,
    AVCaptureDeviceTypeContinuityCamera, AVCaptureDeviceTypeExternal,
    AVCaptureDeviceWasDisconnectedNotification, AVCaptureOutput, AVCaptureSession,
    AVCaptureSessionRuntimeErrorNotification, AVCaptureVideoDataOutput,
    AVCaptureVideoDataOutputSampleBufferDelegate, AVMediaTypeVideo,
};
use objc2_core_foundation::{CFDictionary, CFRetained, CFType, CGPoint, CGRect};
use objc2_core_media::{CMSampleBuffer, CMTime};
use objc2_core_video::{
    kCVPixelBufferPixelFormatTypeKey, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
    CVPixelBuffer, CVPixelBufferGetHeight, CVPixelBufferGetWidth,
};
use objc2_foundation::{
    NSArray, NSData, NSDictionary, NSNotification, NSNotificationCenter, NSNumber, NSString,
};
use objc2_vision::{VNDetectFaceRectanglesRequest, VNImageRequestHandler, VNRequest};
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::ptr::{self, NonNull};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, Weak};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const LIBRARY: &str = "/System/Library/PrivateFrameworks/AppleCVA.framework/Versions/A/AppleCVA";
const LIBRARY_NOT_FOUND: &str = "FaceKit library not found";
const NAMES_CHANGED: &str = "FaceKit output names changed";
const NOT_STARTED: &str = "FaceKit tracker did not start";
const UNEXPECTED: &str = "Unexpected FaceKit output";
const CAMERA_NOT_FOUND: &str = "Camera not found";
const CAMERA_CANNOT_START: &str = "Camera cannot start";
const CAMERA_STOPPED: &str = "Camera stopped";
/// How often the start thread reads the cancel flag while the permission prompt is open.
const PERMISSION_POLL: Duration = Duration::from_millis(50);
const RTLD_NOW: c_int = 2;
const RTLD_LOCAL: c_int = 4;

extern "C" {
    fn dlopen(path: *const c_char, mode: c_int) -> *mut c_void;
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}
// The objc2 binding of this function panics on a NULL result; this one returns the pointer.
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGRectCreateDictionaryRepresentation(rect: CGRect) -> *mut CFDictionary;
}

type VersionFn = unsafe extern "C" fn() -> u32;
type CreateFn = unsafe extern "C" fn(*const c_void, *const CFDictionary, *mut *const c_void) -> i32;
type ProcessFn = unsafe extern "C" fn(*const c_void, *const CFDictionary) -> i32;
type SemanticsFn = unsafe extern "C" fn(*const CFDictionary, *mut *const CFDictionary) -> i32;

/// The four FaceKit functions. The library handle is never closed, so they stay valid.
#[derive(Clone, Copy)]
struct Api {
    version: VersionFn,
    create: CreateFn,
    process: ProcessFn,
    semantics: SemanticsFn,
}

/// Why a run ends. It is small, unlike `FaceEvent`, so it can be an `Err`.
#[derive(Clone, Copy, Debug)]
enum Failure {
    Unavailable(&'static str),
    PermissionNeeded,
    Camera(&'static str),
}
impl Failure {
    fn event(self) -> FaceEvent {
        match self {
            Failure::Unavailable(reason) => FaceEvent::Unavailable(reason.into()),
            Failure::PermissionNeeded => FaceEvent::PermissionNeeded,
            Failure::Camera(reason) => FaceEvent::CameraFailed(reason.into()),
        }
    }
}

/// The result of the FaceKit start-up check.
#[derive(Clone, Debug, PartialEq)]
pub struct FaceKitProbe {
    pub api_version: u32,
    pub names: Vec<String>,
}

/// The library path. Only a debug build reads the `OPENSEKAI_FACEKIT_LIBRARY` override.
fn library_path() -> String {
    #[cfg(debug_assertions)]
    {
        if let Ok(path) = std::env::var("OPENSEKAI_FACEKIT_LIBRARY") {
            return path;
        }
    }
    LIBRARY.into()
}

fn load(path: &str) -> Result<Api, &'static str> {
    let not_found = || LIBRARY_NOT_FOUND;
    let path = CString::new(path).map_err(|_| not_found())?;
    // SAFETY: `path` is NUL-terminated and lives for the call. The handle is never closed.
    let handle = unsafe { dlopen(path.as_ptr(), RTLD_NOW | RTLD_LOCAL) };
    if handle.is_null() {
        return Err(not_found());
    }
    let symbol = |name: &CStr| {
        // SAFETY: a handle from `dlopen` and a NUL-terminated name.
        let pointer = unsafe { dlsym(handle, name.as_ptr()) };
        (!pointer.is_null())
            .then_some(pointer)
            .ok_or_else(not_found)
    };
    let version = symbol(c"CVAFaceTrackingGetAPIVersion")?;
    let create = symbol(c"CVAFaceTrackingCreate")?;
    let process = symbol(c"CVAFaceTrackingProcess")?;
    let semantics = symbol(c"CVAFaceTrackingCopySemantics")?;
    // SAFETY: each symbol is the C function with the signature of spec Appendix A, and a function
    // pointer has the size of a data pointer on macOS.
    unsafe {
        Ok(Api {
            version: std::mem::transmute::<*mut c_void, VersionFn>(version),
            create: std::mem::transmute::<*mut c_void, CreateFn>(create),
            process: std::mem::transmute::<*mut c_void, ProcessFn>(process),
            semantics: std::mem::transmute::<*mut c_void, SemanticsFn>(semantics),
        })
    }
}

/// An Objective-C object as `AnyObject`.
fn any<T: AsRef<AnyObject> + ?Sized>(value: &T) -> &AnyObject {
    value.as_ref()
}
/// A Core Foundation object as `AnyObject`.
///
/// # Safety
/// `value` is a Core Foundation object. Each one is an Objective-C object, so a collection can
/// retain it.
unsafe fn cf_any<T: ?Sized>(value: &T) -> &AnyObject {
    &*(value as *const T as *const AnyObject)
}
/// A Foundation dictionary as its toll-free bridged `CFDictionary`.
fn cf_dictionary(value: &NSDictionary<NSString, AnyObject>) -> *const CFDictionary {
    value as *const NSDictionary<NSString, AnyObject> as *const CFDictionary
}
fn dictionary(entries: &[(&str, &AnyObject)]) -> Retained<NSDictionary<NSString, AnyObject>> {
    let keys: Vec<_> = entries
        .iter()
        .map(|(key, _)| NSString::from_str(key))
        .collect();
    let keys: Vec<&NSString> = keys.iter().map(|key| &**key).collect();
    let values: Vec<&AnyObject> = entries.iter().map(|(_, value)| *value).collect();
    NSDictionary::from_slices(&keys, &values)
}
fn numbers(values: &[f64]) -> Retained<NSArray<NSNumber>> {
    let values: Vec<_> = values.iter().map(|v| NSNumber::new_f64(*v)).collect();
    NSArray::from_retained_slice(&values)
}
fn matrix(rows: [[f64; 3]; 3]) -> Retained<NSArray<NSArray<NSNumber>>> {
    let rows: Vec<_> = rows.iter().map(|row| numbers(row)).collect();
    NSArray::from_retained_slice(&rows)
}
fn get(dictionary: &NSDictionary, key: &str) -> Option<Retained<AnyObject>> {
    dictionary.objectForKey(&NSString::from_str(key))
}
fn get_dictionary(dictionary: &NSDictionary, key: &str) -> Option<Retained<NSDictionary>> {
    get(dictionary, key)?.downcast::<NSDictionary>().ok()
}

/// The 51 blend shape names from `CopySemantics`.
fn semantic_names(api: &Api) -> Result<Vec<String>, &'static str> {
    let changed = || NAMES_CHANGED;
    let mut out: *const CFDictionary = ptr::null();
    // SAFETY: NULL options (Appendix A) and a valid out pointer.
    let status = unsafe { (api.semantics)(ptr::null(), &mut out) };
    let out = NonNull::new(out as *mut CFDictionary)
        .filter(|_| status == 0)
        .ok_or_else(changed)?;
    // SAFETY: `CopySemantics` follows the Copy rule, so the caller owns the dictionary.
    let semantics = unsafe { CFRetained::from_raw(out) };
    // SAFETY: a CFDictionary is a Core Foundation object.
    let semantics = unsafe { cf_any(&*semantics) }
        .downcast_ref::<NSDictionary>()
        .ok_or_else(changed)?;
    let list = get(semantics, "blendshape_names").ok_or_else(changed)?;
    let list = list.downcast_ref::<NSArray>().ok_or_else(changed)?;
    list.iter()
        .map(|name| {
            name.downcast_ref::<NSString>()
                .map(|name| name.to_string())
                .ok_or_else(changed)
        })
        .collect()
}

/// A FaceKit tracker. The `Frames` mutex keeps `Process` and the release apart.
struct Tracker(CFRetained<CFType>);
// SAFETY: the tracker is a Core Foundation object. It is used on the capture queue and released on
// a stop thread, never at the same time (see `Frames::tracker`).
unsafe impl Send for Tracker {}

fn create(api: &Api) -> Result<Tracker, &'static str> {
    let options = dictionary(&[
        ("num_tracked_faces", any(&*NSNumber::new_i32(1))),
        ("rgb_only", any(&*NSNumber::new_bool(true))),
        ("robust_tongue", any(&*NSNumber::new_bool(true))),
        (
            "network_failure_threshold_multiplier",
            any(&*NSNumber::new_f64(1.0)),
        ),
        ("failure_fov_modifier", any(&*NSNumber::new_f64(0.5))),
        ("use_recognition", any(&*NSNumber::new_bool(false))),
    ]);
    let mut out: *const c_void = ptr::null();
    // SAFETY: the default allocator (NULL), an options dictionary that lives for the call, and a
    // valid out pointer.
    let status = unsafe { (api.create)(ptr::null(), cf_dictionary(&options), &mut out) };
    match NonNull::new(out as *mut CFType) {
        // SAFETY: `Create` follows the Create rule, so the caller owns the tracker.
        Some(tracker) if status == 0 => Ok(Tracker(unsafe { CFRetained::from_raw(tracker) })),
        _ => Err(NOT_STARTED),
    }
}

/// Loads FaceKit from `path`, reads the API version and the names, then creates and releases one
/// tracker. No camera opens.
pub fn probe_at(path: &str) -> Result<FaceKitProbe, String> {
    autoreleasepool(|_| {
        let api = load(path)?;
        // SAFETY: `GetAPIVersion` takes no argument.
        let api_version = unsafe { (api.version)() };
        let names = semantic_names(&api)?;
        drop(create(&api)?);
        Ok::<_, &str>(FaceKitProbe { api_version, names })
    })
    .map_err(String::from)
}

/// `probe_at` with the library path (or the debug-build override).
pub fn probe() -> Result<FaceKitProbe, String> {
    probe_at(&library_path())
}

/// The state of one run that the start thread, the capture queue, FaceKit, and `Drop` share.
struct Run {
    sink: FaceSink,
    /// Set by `Drop`. The start thread reads it after each step.
    cancel: AtomicBool,
    /// A run-time stop was asked for: no more `Face` or `NoFace` events.
    failing: AtomicBool,
    /// False after `Drop` or after a terminal event. An event goes out only while it is held.
    open: Mutex<bool>,
    /// The running capture. Its lock is held while a capture starts or stops.
    live: Mutex<Option<Live>>,
}
impl Run {
    fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }
    fn send(&self, event: FaceEvent) {
        let terminal = matches!(
            event,
            FaceEvent::Unavailable(_) | FaceEvent::PermissionNeeded | FaceEvent::CameraFailed(_)
        );
        let mut open = lock(&self.open);
        if !*open || (!terminal && self.failing.load(Ordering::SeqCst)) {
            return;
        }
        (self.sink)(event);
        if terminal {
            *open = false;
        }
    }
    fn stop_live(&self) {
        let mut slot = lock(&self.live);
        drop(slot.take());
    }
    /// A run-time failure: the capture stops and the tracker is released before the terminal event.
    fn fail(self: &Arc<Self>, event: FaceEvent) {
        if self.failing.swap(true, Ordering::SeqCst) {
            return;
        }
        let run = self.clone();
        DispatchQueue::global_queue(GlobalQueueIdentifier::QualityOfService(
            DispatchQoS::Default,
        ))
        .exec_async(move || {
            run.stop_live();
            run.send(event);
        });
    }
}

/// One capture session and what it uses. `Drop` stops it.
struct Live {
    session: Retained<AVCaptureSession>,
    output: Retained<AVCaptureVideoDataOutput>,
    queue: DispatchRetained<DispatchQueue>,
    frames: Arc<Frames>,
    _delegate: Retained<FrameOutput>,
    observers: Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>>,
}
// SAFETY: the start thread makes these objects and then moves them under the `live` mutex, so one
// thread at a time uses them. AVFoundation permits session start and stop from any thread.
unsafe impl Send for Live {}
impl Drop for Live {
    /// Stops the session, waits for the capture queue, then releases the tracker.
    fn drop(&mut self) {
        self.frames.stopped.store(true, Ordering::SeqCst);
        let center = NSNotificationCenter::defaultCenter();
        // SAFETY: a session, an output, and observer tokens of this run. `Drop` never runs on the
        // capture queue (a run-time stop runs on a global queue), so the sync wait cannot deadlock.
        unsafe {
            self.session.stopRunning();
            for observer in &self.observers {
                center.removeObserver(any(&**observer));
            }
            self.output.setSampleBufferDelegate_queue(None, None);
        }
        self.queue.exec_sync(|| {});
        drop(lock(&self.frames.tracker).take());
    }
}

/// The frame state, read on the capture queue.
struct Frames {
    run: Weak<Run>,
    process: ProcessFn,
    /// `None` after the release. `Process` runs only while this lock is held.
    tracker: Mutex<Option<Tracker>>,
    stopped: AtomicBool,
    first_pts: Mutex<Option<f64>>,
}
impl Frames {
    fn on_sample(&self, sample: &CMSampleBuffer) {
        if self.stopped.load(Ordering::SeqCst) {
            return;
        }
        autoreleasepool(|_| self.process_sample(sample));
    }
    fn process_sample(&self, sample: &CMSampleBuffer) {
        // SAFETY: AVFoundation gives a valid sample buffer for the duration of the delegate call.
        let (image, pts) = unsafe { (sample.image_buffer(), sample.presentation_time_stamp()) };
        let Some(image) = image else { return };
        // SAFETY: CMTimeGetSeconds has no precondition.
        let pts = unsafe { pts.seconds() };
        if !pts.is_finite() {
            return;
        }
        let first = *lock(&self.first_pts).get_or_insert(pts);
        // SAFETY: CMTimeMakeWithSeconds and CMTimeCopyAsDictionary have no precondition.
        let Some(timestamp) =
            (unsafe { CMTime::with_seconds(pts - first, 600).as_dictionary(None) })
        else {
            return;
        };
        let (width, height) = (
            CVPixelBufferGetWidth(&image) as f64,
            CVPixelBufferGetHeight(&image) as f64,
        );
        let faces = detected_faces(&image);
        let fx = 400. * width / 640.;
        let intrinsics = matrix([
            [fx, 0., (width - 1.) / 2.],
            [0., fx, (height - 1.) / 2.],
            [0., 0., 1.],
        ]);
        let rotation = matrix([[1., 0., 0.], [0., 1., 0.], [0., 0., 1.]]);
        let translation = numbers(&[0., 0., 0.]);
        let extrinsics = dictionary(&[
            ("rotation", any(&*rotation)),
            ("translation", any(&*translation)),
        ]);
        let camera = dictionary(&[
            ("intrinsics", any(&*intrinsics)),
            ("extrinsics", any(&*extrinsics)),
        ]);
        let light = dictionary(&[("LuxLevel", any(&*NSNumber::new_i32(150)))]);
        let meta = dictionary(&[("version", any(&*NSNumber::new_i32(1)))]);
        let run = self.run.clone();
        let started = Instant::now();
        let callback = RcBlock::new(move |result: *const c_void| on_result(&run, started, result));
        // SAFETY: the pixel buffer and the time dictionary are Core Foundation objects, and a heap
        // block is an Objective-C object. The dictionary retains each of them.
        let input = unsafe {
            dictionary(&[
                ("rgb", cf_any::<CVPixelBuffer>(&image)),
                ("rgb_camera", any(&*camera)),
                ("RgbMetadata", any(&*light)),
                ("meta", any(&*meta)),
                ("timestamp", cf_any::<CFDictionary>(&timestamp)),
                ("DetectedFacesArray", any(&*faces)),
                (
                    "callback",
                    &*(RcBlock::as_ptr(&callback) as *const AnyObject),
                ),
            ])
        };
        let tracker = lock(&self.tracker);
        let Some(tracker) = tracker.as_ref() else {
            return;
        };
        // SAFETY: the tracker stays alive while its lock is held, and the input dictionary lives
        // for the call. FaceKit retains what it keeps.
        unsafe {
            (self.process)(
                CFRetained::as_ptr(&tracker.0).as_ptr().cast(),
                cf_dictionary(&input),
            )
        };
    }
}

/// The `DetectedFacesArray` of Appendix A: empty, or the first Vision face.
fn detected_faces(image: &CVPixelBuffer) -> Retained<NSArray<AnyObject>> {
    let empty = NSArray::new;
    // SAFETY: a valid pixel buffer and empty options (orientation Up).
    let handler = unsafe {
        VNImageRequestHandler::initWithCVPixelBuffer_options(
            VNImageRequestHandler::alloc(),
            image,
            &NSDictionary::new(),
        )
    };
    // SAFETY: a new request with its default settings.
    let request = unsafe { VNDetectFaceRectanglesRequest::new() };
    let requests = NSArray::<VNRequest>::from_slice(&[&**request]);
    if handler.performRequests_error(&requests).is_err() {
        return empty();
    }
    // SAFETY: the request finished; its results are face observations.
    let Some(face) = (unsafe { request.results() }).and_then(|faces| faces.firstObject()) else {
        return empty();
    };
    // SAFETY: plain property reads of a finished observation.
    let (bounds, roll) = unsafe { (face.boundingBox(), face.roll()) };
    // Vision has a bottom-left origin; FaceKit expects a top-left origin.
    let rect = CGRect::new(
        CGPoint::new(bounds.origin.x, 1. - bounds.origin.y - bounds.size.height),
        bounds.size,
    );
    // SAFETY: the function has no precondition and returns a new dictionary or NULL.
    let Some(rect) = NonNull::new(unsafe { CGRectCreateDictionaryRepresentation(rect) }) else {
        return empty();
    };
    // SAFETY: the Create rule: the caller owns the dictionary.
    let rect = unsafe { CFRetained::from_raw(rect) };
    let roll = NSNumber::new_f64(roll.map_or(0., |roll| roll.doubleValue()));
    // SAFETY: a CFDictionary is a Core Foundation object.
    let entry = dictionary(&[
        ("Rect", unsafe { cf_any::<CFDictionary>(&rect) }),
        ("AngleInfoRoll", any(&*roll)),
        ("FaceID", any(&*NSNumber::new_i32(0))),
    ]);
    NSArray::from_slice(&[any(&*entry)])
}

/// The FaceKit result block, on the FaceKit thread.
fn on_result(run: &Weak<Run>, started: Instant, result: *const c_void) {
    let Some(run) = run.upgrade() else { return };
    if run.cancelled() || run.failing.load(Ordering::SeqCst) {
        return;
    }
    let inference_ms = started.elapsed().as_secs_f64() * 1000.;
    // SAFETY: FaceKit passes a CFDictionary (or NULL) that stays valid during the callback
    // (Appendix A), and each Core Foundation object is an Objective-C object.
    let result = unsafe { (result as *const AnyObject).as_ref() };
    let face = autoreleasepool(|_| result.map_or(Ok(None), read_face));
    match face {
        Ok(Some(frame)) => run.send(FaceEvent::Face {
            frame,
            inference_ms,
        }),
        Ok(None) => run.send(FaceEvent::NoFace),
        Err(BadShape) => run.fail(FaceEvent::Unavailable(UNEXPECTED.into())),
    }
}

/// Copies only `raw_data.pose.rotation`, `raw_data.animation.blendshapes`, and `tongue_out` of face 0.
fn read_face(result: &AnyObject) -> Result<Option<FaceFrame>, BadShape> {
    let result = result.downcast_ref::<NSDictionary>().ok_or(BadShape)?;
    let Some(faces) = get(result, "tracked_faces") else {
        return Ok(None);
    };
    let faces = faces.downcast_ref::<NSArray>().ok_or(BadShape)?;
    let Some(face) = faces.firstObject() else {
        return Ok(None);
    };
    let face = face.downcast_ref::<NSDictionary>().ok_or(BadShape)?;
    let raw = get_dictionary(face, "raw_data");
    let rotation = raw
        .as_deref()
        .and_then(|raw| get_dictionary(raw, "pose"))
        .and_then(|pose| get(&pose, "rotation"))
        .map(|rotation| rows(&rotation));
    let animation = raw
        .as_deref()
        .and_then(|raw| get_dictionary(raw, "animation"));
    let blendshapes = animation
        .as_deref()
        .and_then(|animation| get(animation, "blendshapes"))
        .map(|data| {
            data.downcast_ref::<NSData>()
                .map_or_else(Vec::new, |data| data.to_vec())
        });
    let tongue = |animation: Option<&NSDictionary>| {
        get(animation?, "tongue_out")?
            .downcast::<NSNumber>()
            .ok()
            .map(|n| n.doubleValue())
    };
    let tongue_out = tongue(animation.as_deref()).or_else(|| {
        let smooth = get_dictionary(face, "smooth_data")?;
        tongue(get_dictionary(&smooth, "animation").as_deref())
    });
    face_frame(rotation.as_deref(), blendshapes.as_deref(), tongue_out)
}

/// Arrays of numbers as rows. A wrong type gives an empty row, which `face_frame` refuses.
fn rows(value: &AnyObject) -> Vec<Vec<f64>> {
    let Some(rows) = value.downcast_ref::<NSArray>() else {
        return vec![];
    };
    rows.iter()
        .map(|row| {
            let values: Option<Vec<f64>> = row.downcast_ref::<NSArray>().and_then(|row| {
                row.iter()
                    .map(|v| v.downcast_ref::<NSNumber>().map(|n| n.doubleValue()))
                    .collect()
            });
            values.unwrap_or_default()
        })
        .collect()
}

define_class!(
    // The AVFoundation frame output of one run.
    #[unsafe(super(NSObject))]
    #[name = "OpenSekaiFaceKitOutput"]
    #[ivars = Arc<Frames>]
    struct FrameOutput;

    unsafe impl NSObjectProtocol for FrameOutput {}

    unsafe impl AVCaptureVideoDataOutputSampleBufferDelegate for FrameOutput {
        #[unsafe(method(captureOutput:didOutputSampleBuffer:fromConnection:))]
        unsafe fn captureOutput_didOutputSampleBuffer_fromConnection(
            &self,
            _output: &AVCaptureOutput,
            sample: &CMSampleBuffer,
            _connection: &AVCaptureConnection,
        ) {
            self.ivars().on_sample(sample);
        }
    }
);
impl FrameOutput {
    fn new(frames: Arc<Frames>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(frames);
        // SAFETY: `NSObject`'s designated initializer.
        unsafe { msg_send![super(this), init] }
    }
}

/// The camera permission. `Ok` when it is granted or the run was cancelled.
fn camera_access(run: &Run) -> Result<(), Failure> {
    // SAFETY: an AVFoundation constant.
    let video = unsafe { AVMediaTypeVideo }.ok_or(Failure::Camera(CAMERA_NOT_FOUND))?;
    // SAFETY: the video media type is a valid argument.
    match unsafe { AVCaptureDevice::authorizationStatusForMediaType(video) } {
        AVAuthorizationStatus::Authorized => Ok(()),
        AVAuthorizationStatus::NotDetermined => {
            let (sender, receiver) = mpsc::channel();
            let sender = Mutex::new(Some(sender));
            let handler = RcBlock::new(move |granted: Bool| {
                if let Some(sender) = lock(&sender).take() {
                    let _ = sender.send(granted.as_bool());
                }
            });
            // SAFETY: the video media type and a heap block; AVFoundation copies the block.
            unsafe {
                AVCaptureDevice::requestAccessForMediaType_completionHandler(video, &handler)
            };
            loop {
                match receiver.recv_timeout(PERMISSION_POLL) {
                    Ok(true) => return Ok(()),
                    Err(mpsc::RecvTimeoutError::Timeout) if !run.cancelled() => {}
                    _ if run.cancelled() => return Ok(()),
                    _ => return Err(Failure::PermissionNeeded),
                }
            }
        }
        _ => Err(Failure::PermissionNeeded),
    }
}

/// Observes a session runtime error and a disconnect of the device; each one stops the run.
fn watch(
    run: &Arc<Run>,
    session: &AVCaptureSession,
    device: &AVCaptureDevice,
) -> Vec<Retained<ProtocolObject<dyn NSObjectProtocol>>> {
    let center = NSNotificationCenter::defaultCenter();
    // SAFETY: AVFoundation constants.
    let names = unsafe {
        [
            (AVCaptureSessionRuntimeErrorNotification, any(session)),
            (AVCaptureDeviceWasDisconnectedNotification, any(device)),
        ]
    };
    names
        .into_iter()
        .map(|(name, object)| {
            let run = Arc::downgrade(run);
            let block = RcBlock::new(move |_: NonNull<NSNotification>| {
                if let Some(run) = run.upgrade() {
                    run.fail(FaceEvent::CameraFailed(CAMERA_STOPPED.into()));
                }
            });
            // SAFETY: a notification name, its sender, and a heap block that the center copies.
            unsafe {
                center.addObserverForName_object_queue_usingBlock(
                    Some(name),
                    Some(object),
                    None,
                    &block,
                )
            }
        })
        .collect()
}

/// The capture session for `device_id` (`''` is the system default), not started yet.
fn open_camera(
    run: &Arc<Run>,
    device_id: &str,
    api: &Api,
    tracker: Tracker,
) -> Result<Live, Failure> {
    let not_found = || Failure::Camera(CAMERA_NOT_FOUND);
    let cannot_start = || Failure::Camera(CAMERA_CANNOT_START);
    // SAFETY: an AVFoundation constant.
    let video = unsafe { AVMediaTypeVideo }.ok_or_else(not_found)?;
    // SAFETY: plain AVFoundation look-ups.
    let device = unsafe {
        if device_id.is_empty() {
            AVCaptureDevice::defaultDeviceWithMediaType(video)
        } else {
            AVCaptureDevice::deviceWithUniqueID(&NSString::from_str(device_id))
        }
    }
    .ok_or_else(not_found)?;
    // SAFETY: a device from AVFoundation.
    let input = unsafe { AVCaptureDeviceInput::deviceInputWithDevice_error(&device) }
        .map_err(|_| cannot_start())?;
    // SAFETY: new AVFoundation objects with their default settings.
    let (session, output) = unsafe { (AVCaptureSession::new(), AVCaptureVideoDataOutput::new()) };
    // SAFETY: a Core Video constant.
    let format_key = unsafe { kCVPixelBufferPixelFormatTypeKey }.to_string();
    let settings = dictionary(&[(
        format_key.as_str(),
        any(&*NSNumber::new_u32(
            kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
        )),
    )]);
    let queue = DispatchQueue::new("net.opensekai.facekit", None);
    let frames = Arc::new(Frames {
        run: Arc::downgrade(run),
        process: api.process,
        tracker: Mutex::new(Some(tracker)),
        stopped: AtomicBool::new(false),
        first_pts: Mutex::new(None),
    });
    let delegate = FrameOutput::new(frames.clone());
    // SAFETY: a supported pixel format (420f), and a serial queue for the delegate.
    unsafe {
        output.setVideoSettings(Some(&settings));
        output.setAlwaysDiscardsLateVideoFrames(true);
        output.setSampleBufferDelegate_queue(
            Some(ProtocolObject::from_ref(&*delegate)),
            Some(&queue),
        );
    }
    let observers = watch(run, &session, &device);
    let live = Live {
        session,
        output,
        queue,
        frames,
        _delegate: delegate,
        observers,
    };
    // SAFETY: the session is not running; the input and the output belong to it only.
    let added = unsafe {
        live.session.beginConfiguration();
        let added = live.session.canAddInput(&input)
            && {
                live.session.addInput(&input);
                live.session.canAddOutput(&live.output)
            }
            && {
                live.session.addOutput(&live.output);
                true
            };
        live.session.commitConfiguration();
        added
    };
    if !added {
        return Err(cannot_start());
    }
    Ok(live)
}

/// The start sequence of a run. Each step reads the cancel flag; what a step made is released
/// when it returns early (by drop).
fn start_run(run: &Arc<Run>, device_id: &str, path: &str) -> Result<(), Failure> {
    let api = load(path).map_err(Failure::Unavailable)?;
    // SAFETY: `GetAPIVersion` takes no argument.
    let version = unsafe { (api.version)() };
    eprintln!("FaceKit API version {version}");
    if run.cancelled() {
        return Ok(());
    }
    let names = semantic_names(&api).map_err(Failure::Unavailable)?;
    if !names_match(&names) {
        return Err(Failure::Unavailable(NAMES_CHANGED));
    }
    if run.cancelled() {
        return Ok(());
    }
    camera_access(run)?;
    if run.cancelled() {
        return Ok(());
    }
    let tracker = create(&api).map_err(Failure::Unavailable)?;
    if run.cancelled() {
        return Ok(());
    }
    let live = open_camera(run, device_id, &api, tracker)?;
    let mut slot = lock(&run.live);
    // A run-time stop that came during the start sends its own event.
    if run.cancelled() || run.failing.load(Ordering::SeqCst) {
        return Ok(());
    }
    // SAFETY: a configured session; the `live` lock keeps a stop out until it returns.
    let running = unsafe {
        live.session.startRunning();
        live.session.isRunning()
    };
    if !running {
        // Sent under the `live` lock, so a run-time stop that waits for it cannot send first.
        drop(live);
        run.send(Failure::Camera(CAMERA_CANNOT_START).event());
        return Ok(());
    }
    *slot = Some(live);
    Ok(())
}

fn cameras() -> Vec<CameraInfo> {
    // SAFETY: AVFoundation constants (macOS 14 and later, the minimum system version).
    let (video, types) = unsafe {
        (
            AVMediaTypeVideo,
            [
                AVCaptureDeviceTypeBuiltInWideAngleCamera,
                AVCaptureDeviceTypeExternal,
                AVCaptureDeviceTypeContinuityCamera,
            ],
        )
    };
    let Some(video) = video else {
        return vec![];
    };
    let types = NSArray::from_slice(&types);
    // SAFETY: a list of device types and the video media type.
    let devices = unsafe {
        AVCaptureDeviceDiscoverySession::discoverySessionWithDeviceTypes_mediaType_position(
            &types,
            Some(video),
            AVCaptureDevicePosition::Unspecified,
        )
        .devices()
    };
    devices
        .iter()
        // SAFETY: plain property reads.
        .map(|device| unsafe {
            CameraInfo {
                device_id: device.uniqueID().to_string(),
                label: device.localizedName().to_string(),
            }
        })
        .collect()
}

#[derive(Default)]
pub struct MacFaceAdapter;
impl MacFaceAdapter {
    pub fn new() -> Self {
        Self
    }
}
impl FaceAdapter for MacFaceAdapter {
    fn cameras(&self) -> Vec<CameraInfo> {
        autoreleasepool(|_| cameras())
    }
    fn start(&self, device_id: &str, sink: FaceSink) -> Box<dyn FaceRun> {
        let run = Arc::new(Run {
            sink,
            cancel: AtomicBool::new(false),
            failing: AtomicBool::new(false),
            open: Mutex::new(true),
            live: Mutex::new(None),
        });
        let (worker_run, device_id, path) = (run.clone(), device_id.to_string(), library_path());
        let worker = thread::Builder::new()
            .name("opensekai-facekit-start".into())
            .spawn(move || {
                autoreleasepool(|_| {
                    if let Err(failure) = start_run(&worker_run, &device_id, &path) {
                        worker_run.send(failure.event());
                    }
                })
            });
        let worker = match worker {
            Ok(worker) => Some(worker),
            Err(_) => {
                run.send(FaceEvent::Unavailable(NOT_STARTED.into()));
                None
            }
        };
        Box::new(MacFaceRun { run, worker })
    }
}

struct MacFaceRun {
    run: Arc<Run>,
    worker: Option<JoinHandle<()>>,
}
impl FaceRun for MacFaceRun {}
impl Drop for MacFaceRun {
    /// Cancel, close the events, wait for the start step in progress, then stop the session, wait
    /// for the capture queue, and release the tracker (`Live::drop`).
    fn drop(&mut self) {
        self.run.cancel.store(true, Ordering::SeqCst);
        *lock(&self.run.open) = false;
        if let Some(worker) = self.worker.take() {
            if worker.thread().id() != thread::current().id() {
                let _ = worker.join();
            }
        }
        self.run.stop_live();
    }
}
