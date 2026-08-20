// 锁屏屏保：在 ScreenSaverView 中嵌入 WKWebView，渲染与桌面端相同的 HTML 壁纸。
// 锁屏后 macOS 的屏保引擎会在登录窗口之上运行本 bundle，
// 从而实现「锁屏时展示动态壁纸」。
#import <ScreenSaver/ScreenSaver.h>
#import <WebKit/WebKit.h>
#include <pwd.h>
#include <unistd.h>

/// 与主应用 WALLPAPERS 注册表第一项保持一致
static NSString *const kDefaultWallpaperId = @"storm-ship";

/// 主应用切换壁纸时写入的共享文件（相对用户主目录）
static NSString *const kSharedStatePath = @"Library/Application Support/wallpaper-tauri/current-wallpaper";

@interface WallpaperSaverView : ScreenSaverView
@property(nonatomic, strong, nullable) WKWebView *webView;
@end

@implementation WallpaperSaverView

- (instancetype)initWithFrame:(NSRect)frame isPreview:(BOOL)isPreview {
    self = [super initWithFrame:frame isPreview:isPreview];
    if (!self) {
        return nil;
    }

    // 内容由 WKWebView 自绘，这里仅维持屏保动画时钟
    [self setAnimationTimeInterval:1.0 / 30.0];

    WKWebView *webView = [[WKWebView alloc] initWithFrame:self.bounds
                                            configuration:[[WKWebViewConfiguration alloc] init]];
    webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [self addSubview:webView];
    self.webView = webView;

    NSBundle *bundle = [NSBundle bundleForClass:[self class]];
    NSURL *resources = [bundle resourceURL];
    NSString *path = [NSString stringWithFormat:@"wallpapers/%@/index.html",
                      [[self class] currentWallpaperId]];
    NSURL *index = [resources URLByAppendingPathComponent:path];
    if ([[NSFileManager defaultManager] fileExistsAtPath:index.path]) {
        // 壁纸通过相对路径 ../../vendor/three/ 引用公共运行库，放开 Resources 根目录读权限
        [webView loadFileURL:index allowingReadAccessToURL:resources];
    }

    // Sonoma 起 legacyScreenSaver 在正常退出时不再调用 stopAnimation，
    // 监听分布式通知兜底释放 WebView，避免锁屏结束后残留渲染进程耗电
    [[NSDistributedNotificationCenter defaultCenter]
        addObserver:self
           selector:@selector(screenSaverWillStop:)
               name:@"com.apple.screensaver.willstop"
             object:nil];

    return self;
}

/// 内容由 WKWebView 自绘，无需逐帧重绘
- (void)animateOneFrame {
}

- (void)stopAnimation {
    [super stopAnimation];
    [self teardownWebView];
}

- (void)screenSaverWillStop:(NSNotification *)note {
    [self teardownWebView];
}

- (void)teardownWebView {
    [self.webView stopLoading];
    [self.webView removeFromSuperview];
    self.webView = nil;
    [[NSDistributedNotificationCenter defaultCenter] removeObserver:self];
}

- (void)dealloc {
    [[NSDistributedNotificationCenter defaultCenter] removeObserver:self];
}

- (BOOL)hasConfigureSheet {
    return NO;
}

- (NSWindow *)configureSheet {
    return nil;
}

/// 读取主应用写入的当前壁纸 id；文件缺失、不可读（沙盒）或内容非法时回退默认壁纸
+ (NSString *)currentWallpaperId {
    NSString *home = nil;
    // 屏保运行在沙盒容器中时 NSHomeDirectory 指向容器，优先取真实主目录
    struct passwd *pw = getpwuid(getuid());
    if (pw && pw->pw_dir) {
        home = [NSString stringWithUTF8String:pw->pw_dir];
    }
    if (home.length == 0) {
        home = NSHomeDirectory();
    }
    NSString *path = [home stringByAppendingPathComponent:kSharedStatePath];
    NSString *wid = [NSString stringWithContentsOfFile:path
                                              encoding:NSUTF8StringEncoding
                                                 error:nil];
    wid = [wid stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    NSCharacterSet *illegal = [[NSCharacterSet
        characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyz0123456789-"] invertedSet];
    if (wid.length == 0 || [wid rangeOfCharacterFromSet:illegal].location != NSNotFound) {
        return kDefaultWallpaperId;
    }
    return wid;
}

@end
