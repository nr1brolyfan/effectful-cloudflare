/**
 * @module Browser
 *
 * Effect-wrapped Cloudflare Browser Rendering API.
 *
 * Provides a Puppeteer-like interface for browser automation running in
 * Cloudflare Workers. Supports page navigation, screenshots, PDF generation,
 * and JavaScript evaluation.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { Browser } from "effectful-cloudflare/Browser"
 *
 * const program = Effect.gen(function*() {
 *   const browser = yield* Browser
 *   const page = yield* browser.launch()
 *   yield* browser.navigate(page, "https://example.com")
 *   const screenshot = yield* browser.screenshot(page)
 * }).pipe(Effect.provide(Browser.layer(env.BROWSER)))
 * ```
 */

import { Data, Effect, Layer, ServiceMap } from "effect";

// ── Binding type ───────────────────────────────────────────────────────

/**
 * Minimal structural type for Browser Rendering binding.
 *
 * This structural type allows testing with mocks and doesn't require
 * `@cloudflare/workers-types` at runtime. It maps to the Puppeteer API
 * for browser automation in Cloudflare Workers.
 *
 * Browser Rendering provides a Puppeteer-compatible API for headless
 * browser automation: navigation, screenshots, PDFs, and JavaScript evaluation.
 *
 * @example
 * ```ts
 * // Use with native Cloudflare binding
 * const binding: BrowserBinding = env.MYBROWSER
 *
 * // Or use with test mock
 * const binding: BrowserBinding = Testing.memoryBrowser()
 * ```
 */
export interface BrowserBinding {
  /**
   * Launch a new browser session.
   *
   * @param options - Browser launch options (keep_alive, etc.)
   * @returns Promise resolving to a browser instance
   */
  launch(options?: BrowserLaunchOptions): Promise<BrowserInstance>;
}

/**
 * Options for launching a browser session.
 */
export interface BrowserLaunchOptions {
  /**
   * Session keep-alive duration in milliseconds.
   * Maximum: 600000ms (10 minutes)
   */
  readonly keep_alive?: number;
}

/**
 * Browser instance returned from launch.
 */
export interface BrowserInstance {
  /**
   * Close the browser session.
   */
  close(): Promise<void>;
  /**
   * Create a new page (tab) in the browser.
   */
  newPage(): Promise<BrowserPage>;
}

/**
 * Browser page for navigation and interaction.
 */
export interface BrowserPage {
  /**
   * Get the page content (HTML).
   *
   * @returns Promise resolving to page HTML
   */
  content(): Promise<string>;

  /**
   * Evaluate JavaScript in the page context.
   *
   * @param script - JavaScript code to execute
   * @returns Promise resolving to the script result
   */
  evaluate<T = unknown>(script: string): Promise<T>;
  /**
   * Navigate to a URL.
   *
   * @param url - The URL to navigate to
   * @param options - Navigation options (waitUntil, timeout)
   */
  goto(url: string, options?: BrowserGotoOptions): Promise<void>;

  /**
   * Generate a PDF of the page.
   *
   * @param options - PDF options (format, landscape, margin)
   * @returns Promise resolving to PDF buffer
   */
  pdf(options?: BrowserPdfOptions): Promise<ArrayBuffer>;

  /**
   * Take a screenshot of the page.
   *
   * @param options - Screenshot options (fullPage, type, clip)
   * @returns Promise resolving to image buffer
   */
  screenshot(options?: BrowserScreenshotOptions): Promise<ArrayBuffer>;

  /**
   * Get the page title.
   *
   * @returns Promise resolving to page title
   */
  title(): Promise<string>;
}

/**
 * Options for page.goto navigation.
 */
export interface BrowserGotoOptions {
  /**
   * Maximum navigation time in milliseconds.
   */
  readonly timeout?: number;
  /**
   * When to consider navigation succeeded.
   * - `load`: Wait for `load` event
   * - `domcontentloaded`: Wait for `DOMContentLoaded` event
   * - `networkidle0`: Wait until there are no network connections for at least 500ms
   * - `networkidle2`: Wait until there are no more than 2 network connections for at least 500ms
   */
  readonly waitUntil?:
    | "load"
    | "domcontentloaded"
    | "networkidle0"
    | "networkidle2";
}

/**
 * Options for page.screenshot.
 */
export interface BrowserScreenshotOptions {
  /**
   * Clip to specific area.
   */
  readonly clip?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };

  /**
   * Capture the full scrollable page.
   */
  readonly fullPage?: boolean;
  /**
   * Image format.
   */
  readonly type?: "png" | "jpeg";
}

/**
 * Options for page.pdf.
 */
export interface BrowserPdfOptions {
  /**
   * PDF format.
   */
  readonly format?: "A4" | "Letter" | "Legal";

  /**
   * Paper orientation.
   */
  readonly landscape?: boolean;

  /**
   * Page margins.
   */
  readonly margin?: {
    readonly top?: string;
    readonly right?: string;
    readonly bottom?: string;
    readonly left?: string;
  };

  /**
   * Print background graphics.
   */
  readonly printBackground?: boolean;
}

// ── Errors ──────────────────────────────────────────────────────────────

/**
 * Browser Rendering operation failed.
 *
 * Module-specific error wrapping Cloudflare Browser Rendering exceptions.
 * This is an internal error and is not serializable.
 *
 * @example
 * ```ts
 * new BrowserError({
 *   operation: "screenshot",
 *   message: "Failed to capture screenshot",
 *   cause: nativeError
 * })
 * ```
 */
export class BrowserError extends Data.TaggedError("BrowserError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ── Service ─────────────────────────────────────────────────────────────

/**
 * Browser Rendering service for headless browser automation.
 *
 * Provides Puppeteer-like API for browser automation: navigate pages, take
 * screenshots, generate PDFs, and evaluate JavaScript. All methods use
 * `Effect.fn` for automatic tracing and return proper Effect types.
 *
 * @example
 * ```ts
 * import { Browser } from "effectful-cloudflare/Browser"
 * import { Effect } from "effect"
 *
 * const program = Effect.gen(function*() {
 *   const browser = yield* Browser
 *
 *   // Launch browser and navigate
 *   const session = yield* browser.launch({ keep_alive: 60000 })
 *   yield* browser.navigate(session, "https://example.com", { waitUntil: "networkidle0" })
 *
 *   // Take screenshot
 *   const screenshot = yield* browser.screenshot(session, { fullPage: true })
 *
 *   // Generate PDF
 *   const pdf = yield* browser.pdf(session, { format: "A4" })
 *
 *   // Evaluate JavaScript
 *   const title = yield* browser.evaluate<string>(session, "document.title")
 *
 *   // Close browser
 *   yield* Effect.sync(() => session.close())
 * }).pipe(Effect.provide(Browser.layer(env.MYBROWSER)))
 * ```
 */
export class Browser extends ServiceMap.Service<
  Browser,
  {
    readonly launch: (
      options?: BrowserLaunchOptions
    ) => Effect.Effect<BrowserInstance, BrowserError>;
    readonly navigate: (
      page: BrowserPage,
      url: string,
      options?: BrowserGotoOptions
    ) => Effect.Effect<void, BrowserError>;
    readonly screenshot: (
      page: BrowserPage,
      options?: BrowserScreenshotOptions
    ) => Effect.Effect<ArrayBuffer, BrowserError>;
    readonly pdf: (
      page: BrowserPage,
      options?: BrowserPdfOptions
    ) => Effect.Effect<ArrayBuffer, BrowserError>;
    readonly evaluate: <T = unknown>(
      page: BrowserPage,
      script: string
    ) => Effect.Effect<T, BrowserError>;
  }
>()("effectful-cloudflare/Browser") {
  /**
   * Create a Browser service instance from a binding.
   *
   * All browser operations are wrapped in Effect with proper error handling
   * and tracing via `Effect.fn`.
   *
   * @param binding - The Browser Rendering binding from Cloudflare Workers environment
   * @returns Effect that yields a Browser service instance
   *
   * @example
   * ```ts
   * const service = yield* Browser.make(env.MYBROWSER)
   * ```
   */
  static make = Effect.fn("Browser.make")(function* (binding: BrowserBinding) {
    // launch - Create new browser session
    const launch = (options?: BrowserLaunchOptions) =>
      Effect.gen(function* () {
        yield* Effect.logDebug("Browser.launch");
        return yield* Effect.tryPromise({
          try: () => binding.launch(options),
          catch: (cause) =>
            new BrowserError({
              operation: "launch",
              message: "Failed to launch browser session",
              cause,
            }),
        });
      }).pipe(Effect.withSpan("Browser.launch"));

    // navigate - Navigate page to URL
    const navigate = (
      page: BrowserPage,
      url: string,
      options?: BrowserGotoOptions
    ) =>
      Effect.gen(function* () {
        yield* Effect.logDebug("Browser.navigate").pipe(
          Effect.annotateLogs({ url })
        );
        return yield* Effect.tryPromise({
          try: () => page.goto(url, options),
          catch: (cause) =>
            new BrowserError({
              operation: "navigate",
              message: `Failed to navigate to ${url}`,
              cause,
            }),
        });
      }).pipe(Effect.withSpan("Browser.navigate"));

    // screenshot - Capture page as image
    const screenshot = (
      page: BrowserPage,
      options?: BrowserScreenshotOptions
    ) =>
      Effect.gen(function* () {
        yield* Effect.logDebug("Browser.screenshot");
        return yield* Effect.tryPromise({
          try: () => page.screenshot(options),
          catch: (cause) =>
            new BrowserError({
              operation: "screenshot",
              message: "Failed to capture screenshot",
              cause,
            }),
        });
      }).pipe(Effect.withSpan("Browser.screenshot"));

    // pdf - Generate PDF from page
    const pdf = (page: BrowserPage, options?: BrowserPdfOptions) =>
      Effect.gen(function* () {
        yield* Effect.logDebug("Browser.pdf");
        return yield* Effect.tryPromise({
          try: () => page.pdf(options),
          catch: (cause) =>
            new BrowserError({
              operation: "pdf",
              message: "Failed to generate PDF",
              cause,
            }),
        });
      }).pipe(Effect.withSpan("Browser.pdf"));

    // evaluate - Execute JavaScript in page context
    const evaluate = <T = unknown>(page: BrowserPage, script: string) =>
      Effect.gen(function* () {
        yield* Effect.logDebug("Browser.evaluate");
        return yield* Effect.tryPromise<T, BrowserError>({
          try: () => page.evaluate<T>(script),
          catch: (cause) =>
            new BrowserError({
              operation: "evaluate",
              message: "Failed to evaluate JavaScript",
              cause,
            }),
        });
      }).pipe(Effect.withSpan("Browser.evaluate"));

    return Browser.of({
      launch,
      navigate,
      screenshot,
      pdf,
      evaluate,
    });
  });

  /**
   * Create a Browser service layer.
   *
   * @param binding - The Browser Rendering binding from Cloudflare Workers environment
   * @returns Layer that provides the Browser service
   *
   * @example
   * ```ts
   * const BrowserLive = Browser.layer(env.MYBROWSER)
   *
   * const program = Effect.gen(function*() {
   *   const browser = yield* Browser
   *   // use browser...
   * }).pipe(Effect.provide(BrowserLive))
   * ```
   */
  static layer = (binding: BrowserBinding) =>
    Layer.effect(this, this.make(binding));
}
