// The macOS capture adapter (B31 R11): ScreenCaptureKit captures one display or one window, and one
// VideoToolbox session for each stream encodes H.264 Main. No other module calls these APIs.
//
// Threads: ScreenCaptureKit calls the output object on its own serial queue. VideoToolbox calls the
// encoder callback on its own thread. A repeat thread encodes the last image again each 1 s while
// the content does not change, and checks a window size. `Encoder` holds the encoder state behind
// one mutex, so encode calls never overlap.
#![allow(non_snake_case)]
use super::adapter::*;
use block2::RcBlock;
use dispatch2::DispatchQueue;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass};
use objc2_app_kit::NSScreen;
use objc2_core_foundation::{CFDictionary, CFRetained, CFString, CFType};
use objc2_core_graphics::{
    CGPreflightScreenCaptureAccess, CGRequestScreenCaptureAccess, CGWindowListCopyWindowInfo,
    CGWindowListOption,
};
use objc2_core_media::{
    kCMSampleAttachmentKey_NotSync, kCMVideoCodecType_H264, CMFormatDescription, CMSampleBuffer,
    CMTime, CMVideoFormatDescriptionGetH264ParameterSetAtIndex,
};
use objc2_core_video::{
    kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, CVImageBuffer, CVPixelBufferGetHeight,
    CVPixelBufferGetWidth,
};
use objc2_foundation::{NSArray, NSDictionary, NSError, NSNumber, NSString};
use objc2_screen_capture_kit::{
    SCContentFilter, SCDisplay, SCFrameStatus, SCRunningApplication, SCShareableContent, SCStream,
    SCStreamConfiguration, SCStreamDelegate, SCStreamFrameInfoStatus, SCStreamOutput,
    SCStreamOutputType, SCWindow,
};
use objc2_video_toolbox::{
    kVTCompressionPropertyKey_AllowFrameReordering, kVTCompressionPropertyKey_AverageBitRate,
    kVTCompressionPropertyKey_ExpectedFrameRate,
    kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, kVTCompressionPropertyKey_ProfileLevel,
    kVTCompressionPropertyKey_RealTime, kVTEncodeFrameOptionKey_ForceKeyFrame,
    kVTProfileLevel_H264_Main_4_1, VTCompressionSession, VTEncodeInfoFlags, VTSessionSetProperty,
};
use std::ffi::c_void;
use std::ptr::{self, NonNull};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc as sync_mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

/// A ScreenCaptureKit or AppKit object that the adapter moves between threads. These classes are
/// thread safe for the calls this file makes (Apple documents SCStream and SCShareableContent use
/// from any queue).
struct Shared<T>(T);
unsafe impl<T> Send for Shared<T> {}
unsafe impl<T> Sync for Shared<T> {}

const CONTENT_TIMEOUT: Duration = Duration::from_secs(5);
const REPEAT_AFTER: Duration = Duration::from_secs(1);
const BITRATE_1080P: f64 = 12_000_000.;

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
/// A toll-free bridged CF value as its Foundation object, and back.
unsafe fn ns<T: objc2::Message>(value: &CFString) -> &T {
    &*(value as *const CFString as *const T)
}
unsafe fn cf<T: objc2::Message>(value: &T) -> &CFType {
    &*(value as *const T as *const CFType)
}

pub struct MacAdapter {
    pid: i32,
}
impl MacAdapter {
    pub fn new() -> Self {
        Self {
            pid: std::process::id() as i32,
        }
    }
}
/// `SCShareableContent` for on-screen windows, waited for on this (blocking) thread.
fn shareable_content() -> Result<Shared<Retained<SCShareableContent>>, CaptureError> {
    if !CGPreflightScreenCaptureAccess() {
        return Err(CaptureError::PermissionNeeded);
    }
    let (sender, receiver) = sync_mpsc::channel();
    let sender = Mutex::new(Some(sender));
    let block = RcBlock::new(
        move |content: *mut SCShareableContent, error: *mut NSError| {
            let result = match unsafe { Retained::retain(content) } {
                Some(content) if error.is_null() => Ok(Shared(content)),
                _ => Err(()),
            };
            if let Some(sender) = lock(&sender).take() {
                let _ = sender.send(result);
            }
        },
    );
    unsafe {
        SCShareableContent::getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler(
            true, true, &block,
        );
    }
    match receiver.recv_timeout(CONTENT_TIMEOUT) {
        Ok(Ok(content)) => Ok(content),
        // A TCC denial also arrives as an error.
        _ if !CGPreflightScreenCaptureAccess() => Err(CaptureError::PermissionNeeded),
        _ => Err(CaptureError::Failed("shareable content".into())),
    }
}
/// The localized name of each display ID, read on the main thread (NSScreen is main-thread only).
fn display_names() -> Vec<(u32, String)> {
    let names = Arc::new(Mutex::new(Vec::new()));
    let out = names.clone();
    DispatchQueue::main().exec_sync(move || {
        let Some(mtm) = objc2::MainThreadMarker::new() else {
            return;
        };
        let key = NSString::from_str("NSScreenNumber");
        for screen in NSScreen::screens(mtm).iter() {
            let description = screen.deviceDescription();
            let id = description
                .objectForKey(&key)
                .and_then(|n| n.downcast::<NSNumber>().ok())
                .map(|n| n.unsignedIntValue());
            if let Some(id) = id {
                lock(&out).push((id, screen.localizedName().to_string()));
            }
        }
    });
    let names = lock(&names).clone();
    names
}
/// Window IDs front to back (the CGWindowList order).
fn window_order() -> Vec<u32> {
    let Some(list) = CGWindowListCopyWindowInfo(
        CGWindowListOption::OptionOnScreenOnly | CGWindowListOption::ExcludeDesktopElements,
        0,
    ) else {
        return vec![];
    };
    let list: &NSArray<NSDictionary<NSString, AnyObject>> =
        unsafe { &*(&*list as *const _ as *const NSArray<NSDictionary<NSString, AnyObject>>) };
    let key = NSString::from_str("kCGWindowNumber");
    list.iter()
        .filter_map(|info| {
            info.objectForKey(&key)
                .and_then(|n| n.downcast::<NSNumber>().ok())
                .map(|n| n.unsignedIntValue())
        })
        .collect()
}
fn sorted_displays(content: &SCShareableContent) -> Vec<Retained<SCDisplay>> {
    let mut displays: Vec<_> = unsafe { content.displays() }.iter().collect();
    displays.sort_by(|a, b| {
        let (a, b) = unsafe { (a.frame().origin, b.frame().origin) };
        a.x.total_cmp(&b.x).then(a.y.total_cmp(&b.y))
    });
    displays
}
fn window_app(window: &SCWindow) -> Option<Retained<SCRunningApplication>> {
    unsafe { window.owningApplication() }
}
impl CaptureAdapter for MacAdapter {
    fn request_access(&self) {
        if !CGPreflightScreenCaptureAccess() {
            CGRequestScreenCaptureAccess();
        }
    }
    fn inventory(&self) -> Result<Inventory, CaptureError> {
        let content = shareable_content()?;
        let names = display_names();
        let displays = sorted_displays(&content.0)
            .into_iter()
            .map(|d| {
                let id = unsafe { d.displayID() };
                DisplayInfo {
                    id: id as u64,
                    name: names
                        .iter()
                        .find(|(n, _)| *n == id)
                        .map(|(_, name)| name.clone())
                        .unwrap_or_default(),
                    width: unsafe { d.width() }.max(0) as u32,
                    height: unsafe { d.height() }.max(0) as u32,
                }
            })
            .collect();
        let order = window_order();
        let mut windows: Vec<_> = unsafe { content.0.windows() }
            .iter()
            .filter(|w| unsafe { w.windowLayer() == 0 && w.isOnScreen() })
            .filter_map(|w| {
                let app = window_app(&w)?;
                if unsafe { app.processID() } == self.pid {
                    return None;
                }
                let frame = unsafe { w.frame() };
                Some(WindowInfo {
                    id: unsafe { w.windowID() } as u64,
                    app: unsafe { app.bundleIdentifier() }.to_string(),
                    app_name: unsafe { app.applicationName() }.to_string(),
                    title: unsafe { w.title() }
                        .map(|t| t.to_string())
                        .unwrap_or_default(),
                    width: frame.size.width.max(0.) as u32,
                    height: frame.size.height.max(0.) as u32,
                })
            })
            .collect();
        windows.sort_by_key(|w| {
            order
                .iter()
                .position(|id| *id as u64 == w.id)
                .unwrap_or(usize::MAX)
        });
        Ok(Inventory { displays, windows })
    }
    fn start(
        &self,
        target: PlatformTarget,
        config: StreamConfig,
    ) -> Result<StreamHandle, CaptureError> {
        let content = shareable_content()?;
        let (filter, window) = match target {
            PlatformTarget::Display(id) => {
                let display = unsafe { content.0.displays() }
                    .iter()
                    .find(|d| unsafe { d.displayID() } as u64 == id)
                    .ok_or(CaptureError::NotFound)?;
                // Exclude the OpenSekai application, so its windows that open later are excluded too.
                let own: Vec<_> = unsafe { content.0.applications() }
                    .iter()
                    .filter(|a| unsafe { a.processID() } == self.pid)
                    .collect();
                let own = NSArray::from_retained_slice(&own);
                let filter = unsafe {
                    SCContentFilter::initWithDisplay_excludingApplications_exceptingWindows(
                        SCContentFilter::alloc(),
                        &display,
                        &own,
                        &NSArray::new(),
                    )
                };
                (filter, None)
            }
            PlatformTarget::Window(id) => {
                let window = unsafe { content.0.windows() }
                    .iter()
                    .find(|w| unsafe { w.windowID() } as u64 == id)
                    .ok_or(CaptureError::NotFound)?;
                let filter = unsafe {
                    SCContentFilter::initWithDesktopIndependentWindow(
                        SCContentFilter::alloc(),
                        &window,
                    )
                };
                (filter, Some(id as u32))
            }
        };
        // The pixel size of the content (macOS 14 and later give the point to pixel scale).
        let rect = unsafe { filter.contentRect() };
        let scale = unsafe { filter.pointPixelScale() } as f64;
        let (width, height) = config.scaled(
            (rect.size.width * scale).round() as u32,
            (rect.size.height * scale).round() as u32,
        );
        let stream_config = unsafe { SCStreamConfiguration::new() };
        unsafe {
            stream_config.setWidth(width as usize);
            stream_config.setHeight(height as usize);
            stream_config.setMinimumFrameInterval(CMTime::new(1, config.fps as i32));
            stream_config.setShowsCursor(config.cursor);
            stream_config.setPixelFormat(kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange);
            stream_config.setQueueDepth(5);
        }
        let (events, receiver) = mpsc::channel(EVENT_CAPACITY);
        let inner = Arc::new(Inner {
            events,
            encoder: Mutex::new(Encoder::default()),
            started: Instant::now(),
            paused: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
            force_key: AtomicBool::new(true),
            window,
            description: Mutex::new(Vec::new()),
        });
        let output = CaptureOutput::new(inner.clone());
        let delegate = ProtocolObject::from_ref(&*output);
        let stream = unsafe {
            SCStream::initWithFilter_configuration_delegate(
                SCStream::alloc(),
                &filter,
                &stream_config,
                Some(delegate),
            )
        };
        let queue = DispatchQueue::new("net.opensekai.capture", None);
        unsafe {
            stream.addStreamOutput_type_sampleHandlerQueue_error(
                ProtocolObject::from_ref(&*output),
                SCStreamOutputType::Screen,
                Some(&queue),
            )
        }
        .map_err(|_| CaptureError::Failed("stream output".into()))?;
        let (sender, started) = sync_mpsc::channel();
        let sender = Mutex::new(Some(sender));
        let block = RcBlock::new(move |error: *mut NSError| {
            if let Some(sender) = lock(&sender).take() {
                let _ = sender.send(error.is_null());
            }
        });
        unsafe { stream.startCaptureWithCompletionHandler(Some(&block)) };
        match started.recv_timeout(CONTENT_TIMEOUT) {
            Ok(true) => {}
            _ if !CGPreflightScreenCaptureAccess() => return Err(CaptureError::PermissionNeeded),
            _ => return Err(CaptureError::Failed("start".into())),
        }
        let control = Arc::new(Control {
            inner: inner.clone(),
            stream: Shared(stream),
            _output: Shared(output),
            _queue: Shared(queue),
            config: Mutex::new(Shared(stream_config)),
            limits: config,
            size: Mutex::new((width, height)),
        });
        let repeat = control.clone();
        std::thread::Builder::new()
            .name("opensekai-capture-repeat".into())
            .spawn(move || repeat.repeat_loop())
            .map_err(|_| CaptureError::Failed("thread".into()))?;
        Ok(StreamHandle {
            events: receiver,
            control,
        })
    }
}

/// The encoder state of one stream.
#[derive(Default)]
struct Encoder {
    session: Option<Shared<CFRetained<VTCompressionSession>>>,
    size: (u32, u32),
    /// The last captured image, for `request_key` and the 1 s repeat.
    last: Option<Shared<CFRetained<CVImageBuffer>>>,
    last_encode: Option<Instant>,
    last_timestamp: Option<u64>,
}
struct Inner {
    events: mpsc::Sender<StreamEvent>,
    encoder: Mutex<Encoder>,
    started: Instant,
    paused: AtomicBool,
    stopped: AtomicBool,
    /// The next encode is a key frame: at start, after a dropped chunk, and on `request_key`.
    force_key: AtomicBool,
    window: Option<u32>,
    /// The `avcC` of the last config sent, so a new config goes out only after a change. It has
    /// its own lock: VideoToolbox can call the output callback inside `encode_frame`, while the
    /// encoder lock is held.
    description: Mutex<Vec<u8>>,
}
impl Inner {
    fn send(&self, event: StreamEvent) {
        if self.events.try_send(event).is_err() {
            // A full channel drops this event; the next chunk is a key frame (adapter.rs).
            self.force_key.store(true, Ordering::SeqCst);
        }
    }
    /// One frame from ScreenCaptureKit.
    fn on_sample(&self, sample: &CMSampleBuffer) {
        if self.stopped.load(Ordering::SeqCst) {
            return;
        }
        let status = frame_status(sample);
        if status == Some(SCFrameStatus::Blank) || status == Some(SCFrameStatus::Suspended) {
            // A minimized, hidden, or off-screen window (R11): nothing new to draw.
            if !self.paused.swap(true, Ordering::SeqCst) {
                self.send(StreamEvent::Paused);
            }
            return;
        }
        if status == Some(SCFrameStatus::Stopped) {
            self.stopped.store(true, Ordering::SeqCst);
            self.send(StreamEvent::Ended);
            return;
        }
        if status != Some(SCFrameStatus::Complete) {
            // Idle (no change) and Started frames carry no new image; the repeat thread handles it.
            return;
        }
        if self.paused.swap(false, Ordering::SeqCst) {
            self.send(StreamEvent::Resumed);
        }
        let Some(image) = (unsafe { sample.image_buffer() }) else {
            return;
        };
        let mut encoder = lock(&self.encoder);
        encoder.last = Some(Shared(image));
        self.encode(&mut encoder);
    }
    /// Encodes the last image. The caller holds the encoder lock.
    fn encode(&self, encoder: &mut Encoder) {
        let Some(image) = encoder.last.as_ref().map(|i| i.0.clone()) else {
            return;
        };
        let size = (
            CVPixelBufferGetWidth(&image) as u32,
            CVPixelBufferGetHeight(&image) as u32,
        );
        if encoder.session.is_none() || encoder.size != size {
            // A size change gives a new encoder session, a new config, and a key frame (R11).
            if let Some(old) = encoder.session.take() {
                unsafe { old.0.invalidate() };
            }
            match self.new_session(size) {
                Some(session) => {
                    encoder.session = Some(Shared(session));
                    encoder.size = size;
                    lock(&self.description).clear();
                    self.force_key.store(true, Ordering::SeqCst);
                }
                None => {
                    self.send(StreamEvent::Failed("encoder".into()));
                    return;
                }
            }
        }
        let Some(session) = encoder.session.as_ref() else {
            return;
        };
        // Strictly increasing timestamps in µs since the stream start (R10).
        let mut timestamp = self.started.elapsed().as_micros() as u64;
        if let Some(last) = encoder.last_timestamp {
            timestamp = timestamp.max(last + 1);
        }
        encoder.last_timestamp = Some(timestamp);
        encoder.last_encode = Some(Instant::now());
        let key = self.force_key.swap(false, Ordering::SeqCst);
        let properties = key.then(|| {
            let yes = NSNumber::numberWithBool(true);
            let force: &NSString = unsafe { ns(kVTEncodeFrameOptionKey_ForceKeyFrame) };
            NSDictionary::<NSString, NSNumber>::from_slices(&[force], &[&*yes])
        });
        let status = unsafe {
            session.0.encode_frame(
                &image,
                CMTime::new(timestamp as i64, 1_000_000),
                CMTime::new(1, 30),
                properties.as_deref().map(|p| {
                    &*(p as *const NSDictionary<NSString, NSNumber> as *const CFDictionary)
                }),
                ptr::null_mut(),
                ptr::null_mut::<VTEncodeInfoFlags>(),
            )
        };
        if status != 0 {
            self.force_key.store(true, Ordering::SeqCst);
        }
    }
    fn new_session(&self, (width, height): (u32, u32)) -> Option<CFRetained<VTCompressionSession>> {
        let mut out: *mut VTCompressionSession = ptr::null_mut();
        let refcon = self as *const Inner as *mut c_void;
        let status = unsafe {
            VTCompressionSession::create(
                None,
                width as i32,
                height as i32,
                kCMVideoCodecType_H264,
                None,
                None,
                None,
                Some(encoded),
                refcon,
                NonNull::from(&mut out),
            )
        };
        let session = NonNull::new(out).filter(|_| status == 0)?;
        let session = unsafe { CFRetained::from_raw(session) };
        let set = |key: &CFString, value: &CFType| unsafe {
            VTSessionSetProperty(&session, key, Some(value));
        };
        let yes = NSNumber::numberWithBool(true);
        let no = NSNumber::numberWithBool(false);
        let bitrate = NSNumber::numberWithInt(
            (BITRATE_1080P * (width * height) as f64 / (1920. * 1080.)).round() as i32,
        );
        let interval = NSNumber::numberWithDouble(2.);
        let fps = NSNumber::numberWithInt(30);
        unsafe {
            set(kVTCompressionPropertyKey_RealTime, cf(&*yes));
            set(kVTCompressionPropertyKey_AllowFrameReordering, cf(&*no));
            set(
                kVTCompressionPropertyKey_ProfileLevel,
                &*(kVTProfileLevel_H264_Main_4_1 as *const CFString as *const CFType),
            );
            set(kVTCompressionPropertyKey_AverageBitRate, cf(&*bitrate));
            set(
                kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration,
                cf(&*interval),
            );
            set(kVTCompressionPropertyKey_ExpectedFrameRate, cf(&*fps));
        }
        Some(session)
    }
    /// One encoded frame from VideoToolbox.
    fn on_encoded(&self, sample: &CMSampleBuffer, timestamp: u64) {
        let Some(format) = (unsafe { sample.format_description() }) else {
            return;
        };
        let Some((description, codec, size)) = avc_config(&format) else {
            return;
        };
        {
            let mut last = lock(&self.description);
            if *last != description {
                *last = description.clone();
                self.send(StreamEvent::Config(DecoderConfig {
                    codec,
                    description,
                    coded_width: size.0,
                    coded_height: size.1,
                }));
            }
        }
        let Some(data) = (unsafe { sample.data_buffer() }) else {
            return;
        };
        let length = unsafe { data.data_length() };
        let mut bytes = vec![0u8; length];
        let Some(destination) = NonNull::new(bytes.as_mut_ptr().cast::<c_void>()) else {
            return;
        };
        if unsafe { data.copy_data_bytes(0, length, destination) } != 0 {
            return;
        }
        // VideoToolbox gives AVCC with 4-byte lengths, as WebCodecs expects with a description.
        self.send(StreamEvent::Chunk(EncodedChunk {
            key: is_key(sample),
            timestamp_us: timestamp,
            data: bytes,
        }));
    }
}
/// The VideoToolbox output callback. `refcon` is the `Inner` of the stream, which the session
/// outlives never: `Control::stop` and `Drop` invalidate the session first.
unsafe extern "C-unwind" fn encoded(
    refcon: *mut c_void,
    _frame: *mut c_void,
    status: i32,
    _flags: VTEncodeInfoFlags,
    sample: *mut CMSampleBuffer,
) {
    let (Some(inner), Some(sample)) = (unsafe { (refcon as *const Inner).as_ref() }, unsafe {
        sample.as_ref()
    }) else {
        return;
    };
    if status != 0 || inner.stopped.load(Ordering::SeqCst) {
        return;
    }
    // `encode` gives each frame its µs timestamp as the presentation time.
    let pts = unsafe { sample.presentation_time_stamp() };
    inner.on_encoded(sample, pts.value.max(0) as u64);
}
/// The SCStreamFrameInfo status of a captured frame.
fn frame_status(sample: &CMSampleBuffer) -> Option<SCFrameStatus> {
    let attachments = unsafe { sample.sample_attachments_array(false) }?;
    let array: &NSArray<NSDictionary<NSString, AnyObject>> = unsafe {
        &*(&*attachments as *const _ as *const NSArray<NSDictionary<NSString, AnyObject>>)
    };
    let first = array.firstObject()?;
    let status = first
        .objectForKey(unsafe { SCStreamFrameInfoStatus })?
        .downcast::<NSNumber>()
        .ok()?;
    Some(SCFrameStatus(status.integerValue()))
}
/// A sample without the NotSync attachment is a sync (key) frame.
fn is_key(sample: &CMSampleBuffer) -> bool {
    let Some(attachments) = (unsafe { sample.sample_attachments_array(false) }) else {
        return true;
    };
    let array: &NSArray<NSDictionary<NSString, AnyObject>> = unsafe {
        &*(&*attachments as *const _ as *const NSArray<NSDictionary<NSString, AnyObject>>)
    };
    let Some(first) = array.firstObject() else {
        return true;
    };
    let not_sync: &NSString = unsafe { ns(kCMSampleAttachmentKey_NotSync) };
    !first
        .objectForKey(not_sync)
        .and_then(|v| v.downcast::<NSNumber>().ok())
        .is_some_and(|v| v.boolValue())
}
/// The `avcC` record, the codec string, and the coded size from the SPS and PPS of the format.
fn avc_config(format: &CMFormatDescription) -> Option<(Vec<u8>, String, (u32, u32))> {
    let mut sets = Vec::new();
    let mut count = 0usize;
    for index in 0.. {
        let (mut pointer, mut size, mut header) = (ptr::null::<u8>(), 0usize, 0i32);
        let status = unsafe {
            CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
                format,
                index,
                &mut pointer,
                &mut size,
                &mut count,
                &mut header,
            )
        };
        if status != 0 || pointer.is_null() || header != 4 {
            return None;
        }
        sets.push(unsafe { std::slice::from_raw_parts(pointer, size) }.to_vec());
        if index + 1 >= count {
            break;
        }
    }
    let dimensions = unsafe { objc2_core_media::CMVideoFormatDescriptionGetDimensions(format) };
    let size = (
        dimensions.width.max(0) as u32,
        dimensions.height.max(0) as u32,
    );
    let (description, codec) = avcc_record(&sets)?;
    Some((description, codec, size))
}
struct Control {
    inner: Arc<Inner>,
    stream: Shared<Retained<SCStream>>,
    _output: Shared<Retained<CaptureOutput>>,
    _queue: Shared<dispatch2::DispatchRetained<DispatchQueue>>,
    config: Mutex<Shared<Retained<SCStreamConfiguration>>>,
    limits: StreamConfig,
    size: Mutex<(u32, u32)>,
}
impl StreamControl for Control {
    fn request_key(&self) {
        self.inner.force_key.store(true, Ordering::SeqCst);
        let mut encoder = lock(&self.inner.encoder);
        self.inner.encode(&mut encoder);
    }
    fn stop(&self) {
        if self.inner.stopped.swap(true, Ordering::SeqCst) {
            return;
        }
        unsafe { self.stream.0.stopCaptureWithCompletionHandler(None) };
        let mut encoder = lock(&self.inner.encoder);
        if let Some(session) = encoder.session.take() {
            unsafe { session.0.invalidate() };
        }
        encoder.last = None;
    }
}
impl Drop for Control {
    fn drop(&mut self) {
        self.stop();
    }
}
impl Control {
    /// Each 100 ms: encode the last image again after 1 s without a change (R10), and each 1 s
    /// give a window stream a new size when its window was resized (R11).
    fn repeat_loop(self: Arc<Self>) {
        let mut last_size_check = Instant::now();
        while !self.inner.stopped.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(100));
            if self.inner.paused.load(Ordering::SeqCst) {
                continue;
            }
            {
                let mut encoder = lock(&self.inner.encoder);
                if encoder
                    .last_encode
                    .is_some_and(|at| at.elapsed() >= REPEAT_AFTER)
                {
                    self.inner.encode(&mut encoder);
                }
            }
            if self.inner.window.is_some() && last_size_check.elapsed() >= REPEAT_AFTER {
                last_size_check = Instant::now();
                self.follow_window_size();
            }
        }
    }
    fn follow_window_size(&self) {
        let Some(id) = self.inner.window else { return };
        let Ok(content) = shareable_content() else {
            return;
        };
        let Some(window) = unsafe { content.0.windows() }
            .iter()
            .find(|w| unsafe { w.windowID() } == id)
        else {
            return;
        };
        let filter = unsafe {
            SCContentFilter::initWithDesktopIndependentWindow(SCContentFilter::alloc(), &window)
        };
        let rect = unsafe { filter.contentRect() };
        let scale = unsafe { filter.pointPixelScale() } as f64;
        let size = self.limits.scaled(
            (rect.size.width * scale).round() as u32,
            (rect.size.height * scale).round() as u32,
        );
        let mut current = lock(&self.size);
        if *current == size {
            return;
        }
        *current = size;
        let config = lock(&self.config);
        unsafe {
            config.0.setWidth(size.0 as usize);
            config.0.setHeight(size.1 as usize);
            self.stream
                .0
                .updateConfiguration_completionHandler(&config.0, None);
        }
    }
}

define_class!(
    // The ScreenCaptureKit output and delegate of one stream.
    #[unsafe(super(NSObject))]
    #[name = "OpenSekaiCaptureOutput"]
    #[ivars = Arc<Inner>]
    struct CaptureOutput;

    unsafe impl NSObjectProtocol for CaptureOutput {}

    unsafe impl SCStreamOutput for CaptureOutput {
        #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
        unsafe fn stream_didOutputSampleBuffer_ofType(
            &self,
            _stream: &SCStream,
            sample: &CMSampleBuffer,
            kind: SCStreamOutputType,
        ) {
            if kind == SCStreamOutputType::Screen {
                self.ivars().on_sample(sample);
            }
        }
    }

    unsafe impl SCStreamDelegate for CaptureOutput {
        #[unsafe(method(stream:didStopWithError:))]
        unsafe fn stream_didStopWithError(&self, _stream: &SCStream, _error: &NSError) {
            let inner = self.ivars();
            if inner.stopped.swap(true, Ordering::SeqCst) {
                return;
            }
            // A window stream stops when its window closes (R11); another stop is a failure.
            inner.send(if inner.window.is_some() {
                StreamEvent::Ended
            } else {
                StreamEvent::Failed("stream stopped".into())
            });
        }
    }
);
impl CaptureOutput {
    fn new(inner: Arc<Inner>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(inner);
        unsafe { msg_send![super(this), init] }
    }
}
