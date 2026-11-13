// FaceKit probe for issue #260 (TRK-24). Not product code. Written from interface facts only
// (exported symbol names and key strings read on macOS 27.2); no third-party code copied.
// Opens the webcam, feeds frames to AppleCVA's CVAFaceTracking full API, prints what comes back.
// It never reads identity_coefficients, face_id, or debug values. It records only key presence.

#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <dlfcn.h>
#import <mach/mach_time.h>
#import <objc/runtime.h>
#import <pthread.h>
#import <sys/resource.h>

typedef const struct __CVAFaceTracking *CVAFaceTrackingRef;
typedef int32_t (*CreateFn)(CFAllocatorRef, CFDictionaryRef, CVAFaceTrackingRef *);
typedef int32_t (*ProcessFn)(CVAFaceTrackingRef, CFDictionaryRef);
typedef int32_t (*SemanticsFn)(CFDictionaryRef, CFDictionaryRef *);
typedef uint32_t (*VersionFn)(void);

static double now_s(void) {
  static mach_timebase_info_data_t tb;
  if (tb.denom == 0) mach_timebase_info(&tb);
  return (double)mach_absolute_time() * tb.numer / tb.denom / 1e9;
}

static NSSet<NSString *> *private_keys(void) {
  return [NSSet setWithArray:@[@"identity_coefficients", @"face_id", @"debug"]];
}

// Prints the keys and the class name of each value, never a value (no face geometry, no gaze).
static void describe(id obj, int depth, int max) {
  NSString *pad = [@"" stringByPaddingToLength:depth * 2 withString:@" " startingAtIndex:0];
  const char *type = obj ? class_getName([obj class]) : "nil";
  if ([obj isKindOfClass:NSDictionary.class]) {
    printf("%s {\n", type);
    for (id k in [[obj allKeys] sortedArrayUsingSelector:@selector(compare:)]) {
      printf("%s  %s: ", pad.UTF8String, [[k description] UTF8String]);
      if ([private_keys() containsObject:k]) printf("(not read)\n");
      else if (depth < max) describe(obj[k], depth + 1, max); else printf("...\n");
    }
    printf("%s}\n", pad.UTF8String);
  } else if ([obj isKindOfClass:NSArray.class] && [obj count] && depth < max) {
    printf("%s of ", type);
    describe([obj firstObject], depth + 1, max);
  } else {
    printf("%s\n", type);
  }
}

static NSArray<NSNumber *> *floats(NSData *d) {
  if (![d isKindOfClass:NSData.class]) return @[];
  NSUInteger n = d.length / sizeof(float);
  NSMutableArray *out = [NSMutableArray arrayWithCapacity:n];
  const float *p = d.bytes;
  for (NSUInteger i = 0; i < n; i++) [out addObject:@(isfinite(p[i]) ? p[i] : 0)];
  return out;
}

static NSArray<NSArray<NSString *> *> *phases(void) {
  return @[
    @[@"neutral", @"Look at the camera with a relaxed face"],
    @[@"head_left", @"Turn your head to your left"],
    @[@"head_right", @"Turn your head to your right"],
    @[@"head_up", @"Lift your chin up"],
    @[@"head_down", @"Drop your chin down"],
    @[@"tilt_left", @"Tilt your head toward your left shoulder"],
    @[@"tilt_right", @"Tilt your head toward your right shoulder"],
    @[@"closer", @"Face forward and lean closer to the camera"],
    @[@"jaw_open", @"Sit back and open your mouth wide"],
    @[@"blink_left", @"Close only your left eye"],
    @[@"blink_right", @"Close only your right eye"],
    @[@"smile", @"Smile"],
    @[@"tongue", @"Stick your tongue out"],
    @[@"eyes_left", @"Keep your head still and look to your left with your eyes"],
    @[@"eyes_up", @"Keep your head still and look up with your eyes"],
    @[@"covered", @"Cover the camera with your hand"],
    @[@"neutral_end", @"Uncover the camera and relax"],
  ];
}

@interface Probe : NSObject <AVCaptureVideoDataOutputSampleBufferDelegate>
@property CVAFaceTrackingRef tracker;
@property ProcessFn process;
@property NSArray<NSString *> *names;
@property double focalAt640;
@property BOOL callbackInCreate, useDetector, script;
@property double phaseSeconds;
@property NSFileHandle *out;
@property double firstPts, startWall, lastPrint;
@property long frames, noFace, processCalls, processErrors, callbacks, emptyResults, described;
@property NSMutableArray<NSNumber *> *latencies, *processDurations;
@property NSMutableSet<NSString *> *threads;
@property NSString *phase;
@property void (^createCallback)(CFDictionaryRef);
@property double pendingStart;
@end

@implementation Probe

- (void)handle:(CFDictionaryRef)cf start:(double)start {
  double lat = (now_s() - start) * 1000;
  NSDictionary *o = (__bridge NSDictionary *)cf;
  char tn[64] = {0};
  pthread_getname_np(pthread_self(), tn, sizeof tn);
  NSString *thread = [NSString stringWithFormat:@"%s%s", tn[0] ? tn : "(unnamed)", pthread_main_np() ? " [main]" : ""];
  @synchronized(self) {
    self.callbacks++;
    [self.latencies addObject:@(lat)];
    [self.threads addObject:thread];
    if (![o isKindOfClass:NSDictionary.class]) { printf("callback got non-dictionary\n"); return; }
    NSArray *faces = o[@"tracked_faces"];
    NSDictionary *face = [faces isKindOfClass:NSArray.class] ? faces.firstObject : nil;
    if (!face) {
      self.emptyResults++;
      if (self.emptyResults == 1) { printf("\n== first result WITHOUT a tracked face ==\n"); describe(o, 0, 3); }
    } else if (self.described == 0) {
      self.described = 1;
      printf("\n== first result WITH a tracked face (structure) ==\n");
      describe(o, 0, 6);
    }
    NSDictionary *smooth = face[@"smooth_data"], *raw = face[@"raw_data"];
    NSDictionary *anim = smooth[@"animation"], *pose = smooth[@"pose"];
    NSArray *bs = floats(anim[@"blendshapes"]);
    double t = now_s() - self.startWall;
    NSMutableDictionary *line = [@{@"t": @(t), @"phase": self.phase ?: @"", @"lat_ms": @(lat), @"face": @(face != nil)} mutableCopy];
    if (o[@"data_failure"]) line[@"data_failure"] = [o[@"data_failure"] description];
    if (face) {
      line[@"conf"] = face[@"confidence"] ?: NSNull.null;
      line[@"failure_type"] = face[@"failure_type"] ?: NSNull.null;
      line[@"bs"] = bs;
      line[@"rot"] = pose[@"rotation"] ?: NSNull.null;
      line[@"trans"] = pose[@"translation"] ?: NSNull.null;
      line[@"tongue"] = anim[@"tongue_out"] ?: NSNull.null;
      line[@"gaze"] = anim[@"gaze"] ?: NSNull.null;
      line[@"eyes"] = @[anim[@"left_eye_pitch"] ?: @0, anim[@"left_eye_yaw"] ?: @0, anim[@"right_eye_pitch"] ?: @0, anim[@"right_eye_yaw"] ?: @0];
      line[@"raw_bs"] = floats(raw[@"animation"][@"blendshapes"]);
      line[@"raw_rot"] = raw[@"pose"][@"rotation"] ?: NSNull.null;
      line[@"raw_tongue"] = raw[@"animation"][@"tongue_out"] ?: NSNull.null;
      line[@"has_identity"] = @(face[@"identity_coefficients"] != nil);
    }
    @try {
      NSData *json = [NSJSONSerialization dataWithJSONObject:line options:0 error:nil];
      if (json && self.out) { [self.out writeData:json]; [self.out writeData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]]; }
    } @catch (NSException *e) { printf("json error: %s\n", e.reason.UTF8String); }

    if (t - self.lastPrint >= 0.5) {
      self.lastPrint = t;
      if (!face) { printf("[%5.1fs %-10s] no tracked face  lat=%.1fms\n", t, self.phase.UTF8String ?: "", lat); return; }
      NSMutableArray *idx = [NSMutableArray array];
      for (NSUInteger i = 0; i < bs.count; i++) [idx addObject:@(i)];
      [idx sortUsingComparator:^(NSNumber *a, NSNumber *b) { return [bs[b.intValue] compare:bs[a.intValue]]; }];
      NSMutableString *top = [NSMutableString string];
      for (NSUInteger i = 0; i < MIN(5, idx.count); i++) {
        int k = [idx[i] intValue];
        [top appendFormat:@"%@=%.2f ", k < (int)self.names.count ? self.names[k] : @(k), [bs[k] floatValue]];
      }
      NSArray *tr = pose[@"translation"];
      printf("[%5.1fs %-10s] conf=%.3f fail=%s lat=%.1fms trans=(%.0f,%.0f,%.0f) tongue=%.2f | %s\n", t, self.phase.UTF8String ?: "",
             [face[@"confidence"] doubleValue], [[face[@"failure_type"] description] UTF8String] ?: "-", lat,
             [tr[0] doubleValue], [tr[1] doubleValue], [tr[2] doubleValue], [anim[@"tongue_out"] doubleValue], top.UTF8String);
    }
  }
}

- (void)captureOutput:(AVCaptureOutput *)output didOutputSampleBuffer:(CMSampleBufferRef)sb fromConnection:(AVCaptureConnection *)c {
  CVPixelBufferRef pb = CMSampleBufferGetImageBuffer(sb);
  if (!pb) return;
  double pts = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sb));
  size_t w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb);
  if (self.frames == 0) {
    self.firstPts = pts;
    OSType f = CVPixelBufferGetPixelFormatType(pb);
    printf("first frame: %zux%zu format=%c%c%c%c\n", w, h, (char)(f >> 24), (char)(f >> 16), (char)(f >> 8), (char)f);
  }
  self.frames++;

  NSArray *detected = @[];
  if (!self.useDetector) {
    VNDetectFaceRectanglesRequest *req = [VNDetectFaceRectanglesRequest new];
    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCVPixelBuffer:pb orientation:kCGImagePropertyOrientationUp options:@{}];
    [handler performRequests:@[req] error:nil];
    VNFaceObservation *f = req.results.firstObject;
    if (f) {
      CGRect bb = f.boundingBox;
      CGRect top = CGRectMake(bb.origin.x, 1.0 - bb.origin.y - bb.size.height, bb.size.width, bb.size.height);
      NSDictionary *rect = CFBridgingRelease(CGRectCreateDictionaryRepresentation(top));
      detected = @[@{@"Rect": rect, @"AngleInfoRoll": @(f.roll.doubleValue), @"FaceID": @0}];
    } else {
      self.noFace++;
    }
  }

  double fx = self.focalAt640 * (double)w / 640.0;
  NSArray *identity = @[@[@1, @0, @0], @[@0, @1, @0], @[@0, @0, @1]];
  double start = now_s();
  __weak Probe *weak = self;
  void (^cb)(CFDictionaryRef) = ^(CFDictionaryRef result) { [weak handle:result start:start]; };
  NSMutableDictionary *input = [@{
    @"rgb": (__bridge id)pb,
    @"rgb_camera": @{
      @"intrinsics": @[@[@(fx), @0, @((w - 1) / 2.0)], @[@0, @(fx), @((h - 1) / 2.0)], @[@0, @0, @1]],
      @"extrinsics": @{@"rotation": identity, @"translation": @[@0, @0, @0]},
    },
    @"RgbMetadata": @{@"LuxLevel": @150},
    @"meta": @{@"version": @1},
    @"timestamp": CFBridgingRelease(CMTimeCopyAsDictionary(CMTimeMakeWithSeconds(pts - self.firstPts, 600), NULL)),
    @"DetectedFacesArray": detected,
  } mutableCopy];
  if (self.callbackInCreate) self.pendingStart = start; else input[@"callback"] = [cb copy];

  int32_t rc = self.process(self.tracker, (__bridge CFDictionaryRef)input);
  double dur = (now_s() - start) * 1000;
  @synchronized(self) {
    self.processCalls++;
    [self.processDurations addObject:@(dur)];
    if (rc != 0) { self.processErrors++; if (self.processErrors <= 3) printf("CVAFaceTrackingProcess returned %d\n", rc); }
  }
}
@end

static double pct(NSArray<NSNumber *> *a, double p) {
  if (!a.count) return NAN;
  NSArray *s = [a sortedArrayUsingSelector:@selector(compare:)];
  return [s[(NSUInteger)MIN(s.count - 1, floor(p * s.count))] doubleValue];
}

static NSString *arg(NSString *name, NSString *fallback) {
  NSArray *a = NSProcessInfo.processInfo.arguments;
  NSUInteger i = [a indexOfObject:name];
  return (i != NSNotFound && i + 1 < a.count) ? a[i + 1] : fallback;
}
static BOOL flag(NSString *name) { return [NSProcessInfo.processInfo.arguments containsObject:name]; }

int main(void) {
  @autoreleasepool {
    setvbuf(stdout, NULL, _IOLBF, 0);
    NSArray *types = @[AVCaptureDeviceTypeBuiltInWideAngleCamera, AVCaptureDeviceTypeExternal, AVCaptureDeviceTypeContinuityCamera];
    NSArray<AVCaptureDevice *> *devices = [AVCaptureDeviceDiscoverySession discoverySessionWithDeviceTypes:types mediaType:AVMediaTypeVideo position:AVCaptureDevicePositionUnspecified].devices;
    if (flag(@"--list")) {
      for (AVCaptureDevice *d in devices) printf("%s\n", d.localizedName.UTF8String);
      return 0;
    }

    void *lib = dlopen("/System/Library/PrivateFrameworks/AppleCVA.framework/Versions/A/AppleCVA", RTLD_NOW);
    if (!lib) { printf("UNAVAILABLE: dlopen failed: %s\n", dlerror()); return 3; }
    CreateFn create = dlsym(lib, "CVAFaceTrackingCreate");
    ProcessFn process = dlsym(lib, "CVAFaceTrackingProcess");
    SemanticsFn semantics = dlsym(lib, "CVAFaceTrackingCopySemantics");
    VersionFn version = dlsym(lib, "CVAFaceTrackingGetAPIVersion");
    if (!create || !process || !semantics) { printf("UNAVAILABLE: missing symbol\n"); return 3; }
    if (version) printf("CVAFaceTrackingGetAPIVersion = %u\n", version());

    AVAuthorizationStatus st = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
    printf("camera authorization status = %ld\n", (long)st);
    if (st == AVAuthorizationStatusNotDetermined) {
      dispatch_semaphore_t sem = dispatch_semaphore_create(0);
      [AVCaptureDevice requestAccessForMediaType:AVMediaTypeVideo completionHandler:^(BOOL ok) { dispatch_semaphore_signal(sem); }];
      dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);
      st = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
    }
    if (st != AVAuthorizationStatusAuthorized) { printf("DENIED: camera authorization status %ld\n", (long)st); return 2; }

    Probe *probe = [Probe new];
    probe.process = process;
    probe.focalAt640 = arg(@"--fx", @"400").doubleValue;
    probe.callbackInCreate = [arg(@"--cb", @"frame") isEqualToString:@"create"];
    probe.useDetector = flag(@"--detector");
    probe.script = flag(@"--script");
    probe.phaseSeconds = arg(@"--phase-seconds", @"4").doubleValue;
    probe.latencies = [NSMutableArray array];
    probe.processDurations = [NSMutableArray array];
    probe.threads = [NSMutableSet set];
    double seconds = probe.script ? probe.phaseSeconds * phases().count : arg(@"--seconds", @"8").doubleValue;
    NSString *outPath = arg(@"--out", nil);
    if (outPath) {
      [NSFileManager.defaultManager createFileAtPath:outPath contents:nil attributes:nil];
      probe.out = [NSFileHandle fileHandleForWritingAtPath:outPath];
    }

    NSMutableDictionary *opts = [@{
      @"num_tracked_faces": @1,
      @"rgb_only": @YES,
      @"robust_tongue": @YES,
      @"network_failure_threshold_multiplier": @1.0,
      @"failure_fov_modifier": @0.5,
      @"use_recognition": @NO,
    } mutableCopy];
    if (arg(@"--fitting", nil)) opts[@"fittingEnabled"] = @(arg(@"--fitting", nil).boolValue);
    if (flag(@"--force-cpu")) opts[@"force_cpu"] = @YES;
    if (probe.useDetector) opts[@"use_face_detector"] = @YES;
    if (probe.callbackInCreate) {
      __weak Probe *weak = probe;
      probe.createCallback = ^(CFDictionaryRef result) { [weak handle:result start:weak.pendingStart]; };
      opts[@"callback"] = probe.createCallback;
    }
    printf("create options: %s\n", opts.description.UTF8String);

    CVAFaceTrackingRef tracker = NULL;
    double t0 = now_s();
    int32_t rc = create(kCFAllocatorDefault, (__bridge CFDictionaryRef)opts, &tracker);
    printf("CVAFaceTrackingCreate rc=%d tracker=%p (%.0f ms)\n", rc, tracker, (now_s() - t0) * 1000);
    if (rc != 0 || !tracker) { printf("UNAVAILABLE: create failed\n"); return 3; }
    probe.tracker = tracker;

    CFDictionaryRef sem = NULL;
    rc = semantics(NULL, &sem);
    NSDictionary *semDict = CFBridgingRelease(sem);
    probe.names = semDict[@"blendshape_names"];
    printf("CVAFaceTrackingCopySemantics rc=%d keys=%s\n", rc, [[semDict.allKeys componentsJoinedByString:@","] UTF8String]);
    printf("blendshape_names[%lu]: %s\n", (unsigned long)probe.names.count, [[probe.names componentsJoinedByString:@" "] UTF8String]);

    NSString *want = arg(@"--device", nil);
    AVCaptureDevice *device = [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeVideo];
    for (AVCaptureDevice *d in devices) if (want && [d.localizedName localizedCaseInsensitiveContainsString:want]) device = d;
    if (!device) { printf("CAMERA FAILURE: no device\n"); return 4; }
    printf("camera: %s\n", device.localizedName.UTF8String);
    NSError *err = nil;
    AVCaptureDeviceInput *in = [AVCaptureDeviceInput deviceInputWithDevice:device error:&err];
    if (!in) { printf("CAMERA FAILURE: %s\n", err.localizedDescription.UTF8String); return 4; }
    AVCaptureSession *session = [AVCaptureSession new];
    [session addInput:in];
    int wantWidth = arg(@"--width", @"0").intValue;
    if (wantWidth) {
      for (AVCaptureDeviceFormat *f in device.formats) {
        CMVideoDimensions d = CMVideoFormatDescriptionGetDimensions(f.formatDescription);
        if (d.width == wantWidth && [device lockForConfiguration:nil]) {
          device.activeFormat = f;
          [device unlockForConfiguration];
          printf("active format set to %dx%d\n", d.width, d.height);
          break;
        }
      }
    }
    AVCaptureVideoDataOutput *video = [AVCaptureVideoDataOutput new];
    video.videoSettings = @{(id)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_420YpCbCr8BiPlanarFullRange)};
    video.alwaysDiscardsLateVideoFrames = YES;
    [video setSampleBufferDelegate:probe queue:dispatch_queue_create("probe.capture", DISPATCH_QUEUE_SERIAL)];
    [session addOutput:video];

    struct rusage ru0; getrusage(RUSAGE_SELF, &ru0);
    probe.startWall = now_s();
    [session startRunning];

    if (probe.script) {
      NSArray *ps = phases();
      for (NSUInteger i = 0; i < ps.count; i++) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(i * probe.phaseSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
          @synchronized(probe) { probe.phase = ps[i][0]; }
          printf("\n>>> %s\n", [ps[i][1] UTF8String]);
          NSTask *say = [NSTask new];
          say.launchPath = @"/usr/bin/say";
          say.arguments = @[ps[i][1]];
          [say launch];
        });
      }
    }

    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      [session stopRunning];
      double wall = now_s() - probe.startWall;
      struct rusage ru1; getrusage(RUSAGE_SELF, &ru1);
      double cpu = (ru1.ru_utime.tv_sec - ru0.ru_utime.tv_sec) + (ru1.ru_utime.tv_usec - ru0.ru_utime.tv_usec) / 1e6 +
                   (ru1.ru_stime.tv_sec - ru0.ru_stime.tv_sec) + (ru1.ru_stime.tv_usec - ru0.ru_stime.tv_usec) / 1e6;
      usleep(300000);
      @synchronized(probe) {
        printf("\n== summary ==\n");
        printf("wall=%.1fs frames=%ld (%.1f fps) vision_no_face=%ld process_calls=%ld process_errors=%ld callbacks=%ld results_without_face=%ld\n",
               wall, probe.frames, probe.frames / wall, probe.noFace, probe.processCalls, probe.processErrors, probe.callbacks, probe.emptyResults);
        printf("callback latency ms: p50=%.1f p95=%.1f max=%.1f\n", pct(probe.latencies, 0.5), pct(probe.latencies, 0.95), pct(probe.latencies, 1.0));
        printf("Process() call duration ms: p50=%.1f p95=%.1f\n", pct(probe.processDurations, 0.5), pct(probe.processDurations, 0.95));
        printf("process CPU (capture + Vision + FaceKit): %.2fs over %.1fs = %.0f%% of one core\n", cpu, wall, cpu / wall * 100);
        printf("callback threads: %s\n", [[probe.threads.allObjects componentsJoinedByString:@" | "] UTF8String]);
      }
      CFRelease(tracker);
      printf("tracker released\n");
      exit(0);
    });
    dispatch_main();
  }
}
