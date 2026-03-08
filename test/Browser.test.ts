import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { Browser } from "../src/Browser.js";
import { memoryBrowser } from "../src/Testing.js";

// ── Browser launch and session ──────────────────────────────────────────

it.effect("launches browser session", () =>
  Effect.gen(function* () {
    const browser = yield* Browser;
    const instance = yield* browser.launch({ keep_alive: 60_000 });

    expect(instance).toBeDefined();
    expect(instance.close).toBeDefined();
    expect(instance.newPage).toBeDefined();
  }).pipe(Effect.provide(Browser.layer(memoryBrowser())))
);

it.effect("creates new page in browser session", () =>
  Effect.gen(function* () {
    const browser = yield* Browser;
    const instance = yield* browser.launch();
    const page = yield* Effect.promise(() => instance.newPage());

    expect(page).toBeDefined();
    expect(page.goto).toBeDefined();
    expect(page.content).toBeDefined();
    expect(page.screenshot).toBeDefined();
    expect(page.pdf).toBeDefined();
    expect(page.evaluate).toBeDefined();
  }).pipe(Effect.provide(Browser.layer(memoryBrowser())))
);

// ── Page navigation ─────────────────────────────────────────────────────

it.effect("navigates to URL and gets content", () => {
  const binding = memoryBrowser({
    pageContent: {
      "https://example.com":
        "<html><head><title>Example Domain</title></head><body><h1>Example</h1></body></html>",
    },
  });

  return Effect.gen(function* () {
    const browser = yield* Browser;

    const instance = yield* browser.launch();
    const page = yield* Effect.promise(() => instance.newPage());

    yield* browser.navigate(page, "https://example.com");

    const content = yield* Effect.promise(() => page.content());
    expect(content).toContain("Example Domain");
    expect(content).toContain("<h1>Example</h1>");

    const title = yield* Effect.promise(() => page.title());
    expect(title).toBe("Example Domain");
  }).pipe(Effect.provide(Browser.layer(binding)));
});

it.effect("navigates to URL with wait options", () =>
  Effect.gen(function* () {
    const browser = yield* Browser;
    const instance = yield* browser.launch();
    const page = yield* Effect.promise(() => instance.newPage());

    // Should succeed with various wait options
    yield* browser.navigate(page, "https://example.com", {
      waitUntil: "networkidle0",
      timeout: 30_000,
    });

    const content = yield* Effect.promise(() => page.content());
    expect(content).toBeDefined();
  }).pipe(Effect.provide(Browser.layer(memoryBrowser())))
);

it.effect("navigates to multiple pages", () => {
  const binding = memoryBrowser({
    pageContent: {
      "https://page1.com": "<html><body>Page 1</body></html>",
      "https://page2.com": "<html><body>Page 2</body></html>",
    },
  });

  return Effect.gen(function* () {
    const browser = yield* Browser;

    const instance = yield* browser.launch();
    const page = yield* Effect.promise(() => instance.newPage());

    // Navigate to first page
    yield* browser.navigate(page, "https://page1.com");
    let content = yield* Effect.promise(() => page.content());
    expect(content).toContain("Page 1");

    // Navigate to second page
    yield* browser.navigate(page, "https://page2.com");
    content = yield* Effect.promise(() => page.content());
    expect(content).toContain("Page 2");
  }).pipe(Effect.provide(Browser.layer(binding)));
});

// ── Screenshot ──────────────────────────────────────────────────────────

it.effect("takes screenshot of page", () =>
  Effect.gen(function* () {
    const browser = yield* Browser;
    const instance = yield* browser.launch();
    const page = yield* Effect.promise(() => instance.newPage());

    yield* browser.navigate(page, "https://example.com");
    const screenshot = yield* browser.screenshot(page);

    expect(screenshot).toBeInstanceOf(ArrayBuffer);
    expect(screenshot.byteLength).toBeGreaterThan(0);
  }).pipe(Effect.provide(Browser.layer(memoryBrowser())))
);

it.effect("takes screenshot with options", () =>
  Effect.gen(function* () {
    const browser = yield* Browser;
    const instance = yield* browser.launch();
    const page = yield* Effect.promise(() => instance.newPage());

    yield* browser.navigate(page, "https://example.com");

    // Screenshot with full page option
    const fullPageScreenshot = yield* browser.screenshot(page, {
      fullPage: true,
    });
    expect(fullPageScreenshot).toBeInstanceOf(ArrayBuffer);

    // Screenshot with clip area
    const clippedScreenshot = yield* browser.screenshot(page, {
      clip: { x: 0, y: 0, width: 100, height: 100 },
    });
    expect(clippedScreenshot).toBeInstanceOf(ArrayBuffer);

    // Screenshot with type option
    const jpegScreenshot = yield* browser.screenshot(page, { type: "jpeg" });
    expect(jpegScreenshot).toBeInstanceOf(ArrayBuffer);
  }).pipe(Effect.provide(Browser.layer(memoryBrowser())))
);

// ── PDF generation ──────────────────────────────────────────────────────

it.effect("generates PDF of page", () =>
  Effect.gen(function* () {
    const browser = yield* Browser;
    const instance = yield* browser.launch();
    const page = yield* Effect.promise(() => instance.newPage());

    yield* browser.navigate(page, "https://example.com");
    const pdf = yield* browser.pdf(page);

    expect(pdf).toBeInstanceOf(ArrayBuffer);
    expect(pdf.byteLength).toBeGreaterThan(0);

    // Check for PDF magic bytes
    const view = new Uint8Array(pdf);
    const pdfHeader = new TextDecoder().decode(view.slice(0, 5));
    expect(pdfHeader).toBe("%PDF-");
  }).pipe(Effect.provide(Browser.layer(memoryBrowser())))
);

it.effect("generates PDF with options", () =>
  Effect.gen(function* () {
    const browser = yield* Browser;
    const instance = yield* browser.launch();
    const page = yield* Effect.promise(() => instance.newPage());

    yield* browser.navigate(page, "https://example.com");

    // PDF with format
    const a4Pdf = yield* browser.pdf(page, { format: "A4" });
    expect(a4Pdf).toBeInstanceOf(ArrayBuffer);

    // PDF with landscape
    const landscapePdf = yield* browser.pdf(page, { landscape: true });
    expect(landscapePdf).toBeInstanceOf(ArrayBuffer);

    // PDF with margins
    const marginPdf = yield* browser.pdf(page, {
      margin: {
        top: "1cm",
        right: "1cm",
        bottom: "1cm",
        left: "1cm",
      },
    });
    expect(marginPdf).toBeInstanceOf(ArrayBuffer);

    // PDF with background graphics
    const backgroundPdf = yield* browser.pdf(page, {
      printBackground: true,
    });
    expect(backgroundPdf).toBeInstanceOf(ArrayBuffer);
  }).pipe(Effect.provide(Browser.layer(memoryBrowser())))
);

// ── JavaScript evaluation ───────────────────────────────────────────────

it.effect("evaluates JavaScript in page context", () => {
  const binding = memoryBrowser({
    evaluationResults: {
      "document.title": "Test Page",
      "2 + 2": 4,
      'document.querySelector("h1").textContent': "Heading",
    },
  });

  return Effect.gen(function* () {
    const browser = yield* Browser;

    const instance = yield* browser.launch();
    const page = yield* Effect.promise(() => instance.newPage());

    yield* browser.navigate(page, "https://example.com");

    // Evaluate string result
    const title = yield* browser.evaluate<string>(page, "document.title");
    expect(title).toBe("Test Page");

    // Evaluate number result
    const sum = yield* browser.evaluate<number>(page, "2 + 2");
    expect(sum).toBe(4);

    // Evaluate complex selector
    const headingText = yield* browser.evaluate<string>(
      page,
      'document.querySelector("h1").textContent'
    );
    expect(headingText).toBe("Heading");
  }).pipe(Effect.provide(Browser.layer(binding)));
});

it.effect("evaluates JavaScript with object result", () => {
  const binding = memoryBrowser({
    evaluationResults: {
      "({url: window.location.href, title: document.title})": {
        url: "https://example.com",
        title: "Example",
      },
    },
  });

  return Effect.gen(function* () {
    const browser = yield* Browser;

    const instance = yield* browser.launch();
    const page = yield* Effect.promise(() => instance.newPage());

    yield* browser.navigate(page, "https://example.com");

    const result = yield* browser.evaluate<{ url: string; title: string }>(
      page,
      "({url: window.location.href, title: document.title})"
    );

    expect(result.url).toBe("https://example.com");
    expect(result.title).toBe("Example");
  }).pipe(Effect.provide(Browser.layer(binding)));
});

// ── Error handling ──────────────────────────────────────────────────────

it.effect("wraps binding errors in BrowserError", () =>
  Effect.gen(function* () {
    const errorBinding = {
      launch: () => Promise.reject(new Error("Browser launch failed")),
    };

    const browser = yield* Browser.make(errorBinding);

    const result = yield* browser.launch().pipe(Effect.flip);

    expect(result._tag).toBe("BrowserError");
    if (result._tag === "BrowserError") {
      expect(result.operation).toBe("launch");
      expect(result.message).toBe("Failed to launch browser session");
    }
  })
);

it.effect("can catch BrowserError with catchTag", () =>
  Effect.gen(function* () {
    const errorBinding = {
      launch: () => Promise.reject(new Error("Network error")),
    };

    const browser = yield* Browser.make(errorBinding);

    const result = yield* browser
      .launch()
      .pipe(
        Effect.catchTag("BrowserError", (error) =>
          Effect.succeed(
            `Error in ${error.operation}: ${error.message}` as const
          )
        )
      );

    expect(result).toBe("Error in launch: Failed to launch browser session");
  })
);

// ── Full workflow example ───────────────────────────────────────────────

it.effect("complete browser automation workflow", () => {
  const binding = memoryBrowser({
    pageContent: {
      "https://example.com":
        "<html><head><title>Example</title></head><body><h1>Welcome</h1></body></html>",
    },
    evaluationResults: {
      "document.querySelector('h1').textContent": "Welcome",
    },
  });

  return Effect.gen(function* () {
    const browser = yield* Browser;

    // Launch browser
    const instance = yield* browser.launch({ keep_alive: 60_000 });

    // Create page
    const page = yield* Effect.promise(() => instance.newPage());

    // Navigate to page
    yield* browser.navigate(page, "https://example.com", {
      waitUntil: "networkidle0",
    });

    // Check page loaded correctly
    const content = yield* Effect.promise(() => page.content());
    expect(content).toContain("Welcome");

    // Evaluate JavaScript
    const heading = yield* browser.evaluate<string>(
      page,
      "document.querySelector('h1').textContent"
    );
    expect(heading).toBe("Welcome");

    // Take screenshot
    const screenshot = yield* browser.screenshot(page, { fullPage: true });
    expect(screenshot.byteLength).toBeGreaterThan(0);

    // Generate PDF
    const pdf = yield* browser.pdf(page, { format: "A4" });
    expect(pdf.byteLength).toBeGreaterThan(0);

    // Close browser
    yield* Effect.promise(() => instance.close());
  }).pipe(Effect.provide(Browser.layer(binding)));
});
