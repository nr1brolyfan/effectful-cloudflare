/**
 * @module R2
 *
 * Effect-wrapped Cloudflare Workers R2 object storage.
 *
 * This module provides a fully typed, Effect-based interface to Cloudflare R2
 * with automatic error handling, multipart upload support, presigned URL
 * generation (AWS Signature V4), and multi-instance management via `R2Map`.
 *
 * Key features:
 * - All operations return `Effect` with typed error channels (`R2Error`, `R2MultipartError`, `R2PresignError`)
 * - `getOrFail` variant fails with `NotFoundError` for missing objects
 * - Full `R2Object` return type with body, `text()`, `arrayBuffer()`, etc.
 * - Multipart uploads with `createMultipartUpload` / `resumeMultipartUpload`
 * - S3-compatible presigned URLs via `R2.presign`
 * - Multi-bucket support via `R2Map` (LayerMap)
 * - Automatic tracing spans via `Effect.fn`
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { R2 } from "effectful-cloudflare/R2"
 *
 * const program = Effect.gen(function*() {
 *   const r2 = yield* R2
 *   yield* r2.put("greeting.txt", "Hello World")
 *   const obj = yield* r2.getOrFail("greeting.txt")
 *   const text = yield* Effect.promise(() => obj.text())
 * }).pipe(Effect.provide(R2.layer(env.MY_BUCKET)))
 * ```
 */

import { Data } from "effect";

// ── Task 7.1: R2Binding structural type ────────────────────────────────

/**
 * Minimal structural type for R2Bucket.
 * Allows testing with mocks without requiring @cloudflare/workers-types at runtime.
 */
export interface R2Binding {
  createMultipartUpload(
    key: string,
    options?: {
      httpMetadata?: R2HTTPMetadata;
      customMetadata?: Record<string, string>;
      storageClass?: "Standard" | "InfrequentAccess";
    }
  ): Promise<R2MultipartUpload>;
  delete(keys: string | string[]): Promise<void>;
  get(key: string, options?: unknown): Promise<R2Object | null>;
  head(key: string): Promise<R2ObjectMeta | null>;
  list(options?: {
    prefix?: string;
    delimiter?: string;
    cursor?: string;
    limit?: number;
    include?: ("httpMetadata" | "customMetadata")[];
  }): Promise<R2Objects>;
  put(
    key: string,
    value:
      | ReadableStream
      | ArrayBuffer
      | ArrayBufferView
      | string
      | null
      | Blob,
    options?: {
      httpMetadata?: R2HTTPMetadata;
      customMetadata?: Record<string, string>;
      md5?: ArrayBuffer | string;
      sha1?: ArrayBuffer | string;
      sha256?: ArrayBuffer | string;
      sha384?: ArrayBuffer | string;
      sha512?: ArrayBuffer | string;
      storageClass?: "Standard" | "InfrequentAccess";
    }
  ): Promise<R2ObjectMeta | null>;
  resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload;
}
/**
 * R2 object returned from get/put/head operations.
 *
 * Structural subset of the full `R2Object` from `@cloudflare/workers-types`.
 * Includes both metadata fields and body-reading methods (`text()`, `json()`,
 * `arrayBuffer()`, `blob()`). The `body` property is a `ReadableStream` for
 * streaming reads.
 *
 * @see {@link R2ObjectInfo} for the metadata-only variant (no body).
 */
export interface R2Object {
  /** Read the entire body as an `ArrayBuffer`. */
  arrayBuffer(): Promise<ArrayBuffer>;
  /** Read the entire body as a `Blob`. */
  blob(): Promise<Blob>;
  /** Readable stream of the object body. */
  body: ReadableStream;
  /** Whether the body has already been consumed. */
  bodyUsed: boolean;
  /** Content checksums (MD5, SHA-1, SHA-256, SHA-384, SHA-512). */
  checksums: R2Checksums;
  /** User-defined key-value metadata. */
  customMetadata?: Record<string, string>;
  /** Entity tag uniquely identifying the object version. */
  etag: string;
  /** ETag formatted for HTTP headers (with quotes). */
  httpEtag: string;
  /** Standard HTTP metadata (content-type, cache-control, etc.). */
  httpMetadata?: R2HTTPMetadata;
  /** Parse the body as JSON. */
  json<T = unknown>(): Promise<T>;
  /** Object key (path) in the bucket. */
  key: string;
  /** Byte range of the response if a range request was made. */
  range?: R2Range;
  /** Object size in bytes. */
  size: number;
  /** Read the entire body as a UTF-8 string. */
  text(): Promise<string>;
  /** Timestamp when the object was uploaded. */
  uploaded: Date;
  /** Opaque version identifier. */
  version: string;
  /** Write object HTTP metadata into an existing `Headers` object. */
  writeHttpMetadata(headers: Headers): void;
}

/**
 * Raw R2 list result from the binding.
 *
 * Returned by `R2Binding.list()`. Contains the full `R2Object` items with body
 * methods. For the simplified metadata-only version used by the `R2` service,
 * see {@link R2ListResult}.
 */
export interface R2Objects {
  /** Opaque cursor for fetching the next page. `undefined` when listing is complete. */
  cursor?: string;
  /** Common prefixes when using a delimiter (for hierarchical listing). */
  delimitedPrefixes: string[];
  /** Objects matching the list query. */
  objects: R2ObjectMeta[];
  /** `true` when there are more results beyond this page. */
  truncated: boolean;
}

/**
 * Handle for an in-progress R2 multipart upload.
 *
 * Multipart uploads allow uploading large objects in parts (up to 10 000 parts,
 * each between 5 MB and 5 GB). Parts can be uploaded in parallel and in any
 * order; the final object is assembled by calling `complete()` with all part
 * metadata.
 *
 * @see {@link R2UploadedPart} for the metadata returned by `uploadPart()`.
 */
/**
 * Metadata-only R2 object returned from operations that don't include a body
 * (e.g., `head()`, `R2MultipartUpload.complete()`, `put()`).
 *
 * This type matches the minimal shape returned by Cloudflare's `R2Object`
 * (without body methods). Our service wraps this into richer types.
 */
export interface R2ObjectMeta {
  checksums: R2Checksums;
  customMetadata?: Record<string, string>;
  etag: string;
  httpEtag: string;
  httpMetadata?: R2HTTPMetadata;
  key: string;
  range?: R2Range;
  size: number;
  uploaded: Date;
  version: string;
  writeHttpMetadata(headers: Headers): void;
}

export interface R2MultipartUpload {
  /** Cancel the multipart upload and delete any uploaded parts. */
  abort(): Promise<void>;
  /** Assemble the final object from the uploaded parts. Returns metadata only (no body). */
  complete(uploadedParts: R2UploadedPart[]): Promise<R2ObjectMeta>;
  /** Object key this upload targets. */
  key: string;
  /** Unique identifier for this multipart upload session. */
  uploadId: string;
  /**
   * Upload a single part.
   *
   * @param partNumber - 1-based part index (must be unique within the upload).
   * @param value - Part body data.
   * @returns Metadata for the uploaded part (needed for `complete()`).
   */
  uploadPart(
    partNumber: number,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob
  ): Promise<R2UploadedPart>;
}

/**
 * Metadata for a single uploaded part of a multipart upload.
 *
 * Re-export of Cloudflare's `R2UploadedPart`.
 */
export type R2UploadedPart = globalThis.R2UploadedPart;

/**
 * Standard HTTP metadata stored alongside an R2 object.
 *
 * Re-export of Cloudflare's `R2HTTPMetadata`.
 */
export type R2HTTPMetadata = globalThis.R2HTTPMetadata;

/**
 * Content integrity checksums stored with an R2 object.
 *
 * Re-export of Cloudflare's `R2Checksums`.
 * CF's type includes an additional `toJSON(): R2StringChecksums` method.
 */
export type R2Checksums = globalThis.R2Checksums;

/**
 * Byte range specification for partial object reads.
 *
 * At most one of `offset`+`length` or `suffix` should be set.
 * - `offset` + `length`: read `length` bytes starting at `offset`.
 * - `suffix`: read the last `suffix` bytes of the object.
 */
export interface R2Range {
  /** Number of bytes to read (from `offset`). */
  length?: number;
  /** Starting byte offset (0-based). */
  offset?: number;
  /** Read the last N bytes of the object. */
  suffix?: number;
}

// ── Task 7.2: R2-specific errors ────────────────────────────────────────

/**
 * General R2 object operation error.
 * Wraps unexpected errors from R2 API calls.
 */
export class R2Error extends Data.TaggedError("R2Error")<{
  readonly operation: string;
  readonly message: string;
  readonly key?: string | undefined;
  readonly cause?: unknown;
}> {}

/**
 * Multipart upload operation error.
 * Includes the uploadId for debugging.
 */
export class R2MultipartError extends Data.TaggedError("R2MultipartError")<{
  readonly operation: "create" | "upload" | "complete" | "abort";
  readonly message: string;
  readonly uploadId?: string;
  readonly key?: string;
  readonly cause?: unknown;
}> {}

/**
 * Presigned URL generation error.
 * Used when generating S3-compatible presigned URLs fails.
 */
export class R2PresignError extends Data.TaggedError("R2PresignError")<{
  readonly operation: "get" | "put";
  readonly message: string;
  readonly key: string;
  readonly cause?: unknown;
}> {}

// ── Task 7.3: R2 result types ───────────────────────────────────────────

/**
 * Simplified, immutable R2 object metadata (no body or body-reading methods).
 *
 * Returned by `put()` and `head()` operations where the object body is either
 * not requested or not applicable. Also used as elements of {@link R2ListResult}.
 *
 * @see {@link R2Object} for the full object including body.
 */
export interface R2ObjectInfo {
  /** Content integrity checksums. */
  readonly checksums: R2Checksums;
  /** User-defined key-value metadata. */
  readonly customMetadata?: Record<string, string> | undefined;
  /** Entity tag uniquely identifying the object version. */
  readonly etag: string;
  /** ETag formatted for HTTP headers (with quotes). */
  readonly httpEtag: string;
  /** Standard HTTP metadata (content-type, cache-control, etc.). */
  readonly httpMetadata?: R2HTTPMetadata | undefined;
  /** Object key (path) in the bucket. */
  readonly key: string;
  /** Byte range if a partial read was performed. */
  readonly range?: R2Range | undefined;
  /** Object size in bytes. */
  readonly size: number;
  /** Timestamp when the object was uploaded. */
  readonly uploaded: Date;
  /** Opaque version identifier. */
  readonly version: string;
}

/**
 * Paginated result from an R2 list operation.
 *
 * Contains simplified {@link R2ObjectInfo} items (no body) along with
 * pagination state. Pass `cursor` into the next `list()` call to fetch
 * subsequent pages when `truncated` is `true`.
 *
 * @see {@link R2ListOptions} for configuring the list query.
 */
export interface R2ListResult {
  /** Opaque cursor for the next page. `undefined` when listing is complete. */
  readonly cursor?: string | undefined;
  /** Common prefixes when using a delimiter (for hierarchical listing). */
  readonly delimitedPrefixes: readonly string[];
  /** Object metadata entries matching the query. */
  readonly objects: readonly R2ObjectInfo[];
  /** `true` when more results are available beyond this page. */
  readonly truncated: boolean;
}

/**
 * Options for R2 `get()` and `getOrFail()` operations.
 *
 * Supports conditional reads (`onlyIf`) and partial reads (`range`).
 * When a condition is not met the binding returns `null`.
 */
export interface R2GetOptions {
  /**
   * Conditional read predicates.
   * - ETag-based: return the object only if the etag matches/differs.
   * - Date-based: return only if uploaded before/after the given dates.
   */
  readonly onlyIf?:
    | { readonly etagMatches?: string; readonly etagDoesNotMatch?: string }
    | { readonly uploadedBefore?: Date; readonly uploadedAfter?: Date };
  /**
   * Byte range to read. See {@link R2Range} for semantics.
   */
  readonly range?: {
    readonly offset?: number;
    readonly length?: number;
    readonly suffix?: number;
  };
}

/**
 * Options for R2 `put()` operations.
 *
 * Allows setting HTTP metadata, custom metadata, content checksums for
 * integrity verification, and the storage class for cost optimization.
 */
export interface R2PutOptions {
  /** User-defined key-value metadata stored with the object. */
  readonly customMetadata?: Record<string, string>;
  /** Standard HTTP metadata (content-type, cache-control, etc.). */
  readonly httpMetadata?: R2HTTPMetadata;
  /** Expected MD5 digest for upload integrity verification. */
  readonly md5?: ArrayBuffer | string;
  /** Expected SHA-1 digest for upload integrity verification. */
  readonly sha1?: ArrayBuffer | string;
  /** Expected SHA-256 digest for upload integrity verification. */
  readonly sha256?: ArrayBuffer | string;
  /** Expected SHA-384 digest for upload integrity verification. */
  readonly sha384?: ArrayBuffer | string;
  /** Expected SHA-512 digest for upload integrity verification. */
  readonly sha512?: ArrayBuffer | string;
  /** Storage class. `"InfrequentAccess"` reduces cost for rarely-read objects. */
  readonly storageClass?: "Standard" | "InfrequentAccess";
}

/**
 * Union of body types accepted by R2 `put()` operations.
 *
 * - `ReadableStream` — streaming upload
 * - `ArrayBuffer` / `ArrayBufferView` — binary data
 * - `string` — UTF-8 text
 * - `Blob` — binary blob
 * - `null` — zero-length object
 */
export type R2PutValue =
  | ReadableStream
  | ArrayBuffer
  | ArrayBufferView
  | string
  | null
  | Blob;

/**
 * Options for R2 `list()` operations.
 *
 * Supports prefix filtering, delimiter-based hierarchical listing, cursor-based
 * pagination, and optional inclusion of metadata in results.
 *
 * @see {@link R2ListResult} for the return type.
 */
export interface R2ListOptions {
  /** Opaque cursor from a previous `R2ListResult` for pagination. */
  readonly cursor?: string;
  /** Delimiter for hierarchical listing (commonly `"/"`). */
  readonly delimiter?: string;
  /** Which metadata to include in the listed objects. */
  readonly include?: ReadonlyArray<"httpMetadata" | "customMetadata">;
  /** Maximum number of objects to return (default 1000, max 1000). */
  readonly limit?: number;
  /** Only return objects whose keys start with this prefix. */
  readonly prefix?: string;
}

/**
 * Options for R2 `createMultipartUpload()` operations.
 *
 * Metadata set here is applied to the final assembled object after
 * `complete()` is called.
 */
export interface R2MultipartOptions {
  /** User-defined key-value metadata for the final object. */
  readonly customMetadata?: Record<string, string>;
  /** Standard HTTP metadata for the final object. */
  readonly httpMetadata?: R2HTTPMetadata;
  /** Storage class. `"InfrequentAccess"` reduces cost for rarely-read objects. */
  readonly storageClass?: "Standard" | "InfrequentAccess";
}

/**
 * Options for presigned URL generation via `R2.presign()`.
 *
 * @see {@link R2PresignConfig} for the required AWS S3-compatible credentials.
 */
export interface R2PresignOptions {
  /** URL validity duration in seconds (default: 3600 = 1 hour). */
  readonly expiresIn?: number;
  /** HTTP metadata to include in the signed headers (e.g. `contentType` for PUT). */
  readonly httpMetadata?: R2HTTPMetadata;
}

/**
 * AWS S3-compatible credentials for R2 presigned URL generation.
 *
 * Create an R2 API token in the Cloudflare dashboard under
 * **R2 > Manage R2 API Tokens**. The token provides the `accessKeyId` and
 * `secretAccessKey`. The `accountId` and `bucketName` identify the target.
 *
 * @see {@link R2PresignOptions} for per-URL options (expiry, metadata).
 */
export interface R2PresignConfig {
  /** S3-compatible access key ID from your R2 API token. */
  readonly accessKeyId: string;
  /** Cloudflare account ID (found in the dashboard URL). */
  readonly accountId: string;
  /** Name of the R2 bucket. */
  readonly bucketName: string;
  /** S3-compatible secret access key from your R2 API token. */
  readonly secretAccessKey: string;
}

// ── Task 7.4: R2 Service Class ──────────────────────────────────────────

import { Effect, Layer, LayerMap, ServiceMap } from "effect";
import * as Errors from "./Errors.js";
import { WorkerEnv } from "./Worker.js";

/**
 * R2 service — Effect-wrapped Cloudflare Workers R2 object storage.
 *
 * Provides Effect-based operations for Cloudflare Workers R2 with:
 * - Automatic error handling and typed errors
 * - Multipart upload support
 * - Presigned URL generation
 * - Full R2Object return type with body, text(), arrayBuffer() etc.
 * - Multi-instance support via `R2Map`
 * - Automatic tracing with `Effect.fn`
 *
 * @example
 * ```ts
 * // Single instance
 * const r2Layer = R2.layer(env.MY_BUCKET)
 *
 * const program = Effect.gen(function*() {
 *   const r2 = yield* R2
 *   const obj = yield* r2.get("file.txt")
 *   if (obj) {
 *     const content = yield* Effect.promise(() => obj.text())
 *     console.log(content)
 *   }
 *   yield* r2.put("upload.txt", "Hello World")
 * })
 * ```
 */
export class R2 extends ServiceMap.Service<
  R2,
  {
    readonly get: (
      key: string,
      options?: R2GetOptions
    ) => Effect.Effect<R2Object | null, R2Error>;
    readonly getOrFail: (
      key: string,
      options?: R2GetOptions
    ) => Effect.Effect<R2Object, R2Error | Errors.NotFoundError>;
    readonly put: (
      key: string,
      value: R2PutValue,
      options?: R2PutOptions
    ) => Effect.Effect<R2ObjectInfo, R2Error>;
    readonly delete: (
      key: string | readonly string[]
    ) => Effect.Effect<void, R2Error>;
    readonly head: (key: string) => Effect.Effect<R2ObjectInfo | null, R2Error>;
    readonly list: (
      options?: R2ListOptions
    ) => Effect.Effect<R2ListResult, R2Error>;
    readonly createMultipartUpload: (
      key: string,
      options?: R2MultipartOptions
    ) => Effect.Effect<R2MultipartUpload, R2MultipartError>;
    readonly resumeMultipartUpload: (
      key: string,
      uploadId: string
    ) => Effect.Effect<R2MultipartUpload, R2MultipartError>;
  }
>()("effectful-cloudflare/R2") {
  // ── Task 7.5: Basic CRUD operations ──────────────────────────────────

  /**
   * Create an R2 service from a binding.
   *
   * This static method wraps all R2 operations in Effect programs with:
   * - Automatic error handling via `Effect.tryPromise`
   * - Typed errors (`R2Error`, `R2MultipartError`, `NotFoundError`)
   * - Automatic tracing spans via `Effect.fn`
   * - Simplified metadata in return types (R2ObjectInfo)
   *
   * @param binding - R2 bucket binding from worker environment
   * @returns Effect that yields the R2 service
   *
   * @example
   * ```ts
   * const program = Effect.gen(function*() {
   *   const r2 = yield* R2.make(env.MY_BUCKET)
   *   const obj = yield* r2.get("file.txt")
   *   if (obj) {
   *     const content = yield* Effect.promise(() => obj.text())
   *     console.log(content)
   *   }
   * })
   * ```
   */
  static make = (binding: R2Binding) =>
    Effect.gen(function* () {
      const get = Effect.fn("R2.get")(function* (
        key: string,
        options?: R2GetOptions
      ) {
        yield* Effect.logDebug("R2.get").pipe(Effect.annotateLogs({ key }));
        return yield* Effect.tryPromise({
          try: () => binding.get(key, options),
          catch: (cause) =>
            new R2Error({
              operation: "get",
              message: `Failed to get object: ${key}`,
              key,
              cause,
            }),
        });
      });

      const getOrFail = Effect.fn("R2.getOrFail")(function* (
        key: string,
        options?: R2GetOptions
      ) {
        yield* Effect.logDebug("R2.getOrFail").pipe(
          Effect.annotateLogs({ key })
        );
        const obj = yield* get(key, options);
        if (obj === null) {
          return yield* Effect.fail(
            new Errors.NotFoundError({
              resource: "R2",
              key,
            })
          );
        }
        return obj;
      });

      const put = Effect.fn("R2.put")(function* (
        key: string,
        value: R2PutValue,
        options?: R2PutOptions
      ) {
        yield* Effect.logDebug("R2.put").pipe(Effect.annotateLogs({ key }));
        const obj = yield* Effect.tryPromise({
          try: () => binding.put(key, value, options),
          catch: (cause) =>
            new R2Error({
              operation: "put",
              message: `Failed to put object: ${key}`,
              key,
              cause,
            }),
        });

        // R2 put can return null in rare cases (e.g., conditional put failed)
        if (obj === null) {
          return yield* Effect.fail(
            new R2Error({
              operation: "put",
              message: `Conditional put failed for object: ${key}`,
              key,
              cause: new Error("Put operation returned null"),
            })
          );
        }

        // Map R2Object to simplified R2ObjectInfo (strip body and methods)
        const info: R2ObjectInfo = {
          key: obj.key,
          version: obj.version,
          size: obj.size,
          etag: obj.etag,
          httpEtag: obj.httpEtag,
          checksums: obj.checksums,
          uploaded: obj.uploaded,
          httpMetadata: obj.httpMetadata,
          customMetadata: obj.customMetadata,
          range: obj.range,
        };
        return info;
      });

      const del = Effect.fn("R2.delete")(function* (
        key: string | readonly string[]
      ) {
        yield* Effect.logDebug("R2.delete").pipe(
          Effect.annotateLogs({
            key: typeof key === "string" ? key : `[${key.length} keys]`,
          })
        );
        // Convert readonly array to mutable for binding
        const keyArg = typeof key === "string" ? key : [...key];
        return yield* Effect.tryPromise({
          try: () => binding.delete(keyArg),
          catch: (cause) =>
            new R2Error({
              operation: "delete",
              message: `Failed to delete object${typeof key === "string" ? `: ${key}` : "s"}`,
              key: typeof key === "string" ? key : undefined,
              cause,
            }),
        });
      });

      const head = Effect.fn("R2.head")(function* (key: string) {
        yield* Effect.logDebug("R2.head").pipe(Effect.annotateLogs({ key }));
        const obj = yield* Effect.tryPromise({
          try: () => binding.head(key),
          catch: (cause) =>
            new R2Error({
              operation: "head",
              message: `Failed to head object: ${key}`,
              key,
              cause,
            }),
        });

        if (obj === null) {
          return null;
        }

        // Map R2Object to simplified R2ObjectInfo
        const info: R2ObjectInfo = {
          key: obj.key,
          version: obj.version,
          size: obj.size,
          etag: obj.etag,
          httpEtag: obj.httpEtag,
          checksums: obj.checksums,
          uploaded: obj.uploaded,
          httpMetadata: obj.httpMetadata,
          customMetadata: obj.customMetadata,
          range: obj.range,
        };
        return info;
      });

      const list = Effect.fn("R2.list")(function* (options?: R2ListOptions) {
        yield* Effect.logDebug("R2.list").pipe(
          Effect.annotateLogs({
            ...(options?.prefix !== undefined && { prefix: options.prefix }),
            ...(options?.limit !== undefined && { limit: options.limit }),
          })
        );
        // Convert readonly array to mutable for binding
        const bindingOptions: Parameters<R2Binding["list"]>[0] = options
          ? {
              ...(options.prefix !== undefined && { prefix: options.prefix }),
              ...(options.delimiter !== undefined && {
                delimiter: options.delimiter,
              }),
              ...(options.cursor !== undefined && { cursor: options.cursor }),
              ...(options.limit !== undefined && { limit: options.limit }),
              ...(options.include !== undefined && {
                include: [...options.include],
              }),
            }
          : undefined;

        const result = yield* Effect.tryPromise({
          try: () => binding.list(bindingOptions),
          catch: (cause) =>
            new R2Error({
              operation: "list",
              message: "Failed to list objects",
              cause,
            }),
        });

        // Map R2Objects to R2ListResult with simplified R2ObjectInfo
        const listResult: R2ListResult = {
          objects: result.objects.map((obj) => ({
            key: obj.key,
            version: obj.version,
            size: obj.size,
            etag: obj.etag,
            httpEtag: obj.httpEtag,
            checksums: obj.checksums,
            uploaded: obj.uploaded,
            httpMetadata: obj.httpMetadata,
            customMetadata: obj.customMetadata,
            range: obj.range,
          })),
          truncated: result.truncated,
          cursor: result.cursor,
          delimitedPrefixes: result.delimitedPrefixes,
        };
        return listResult;
      });

      // ── Task 7.6: Multipart upload methods ────────────────────────────

      const createMultipartUpload = Effect.fn("R2.createMultipartUpload")(
        function* (key: string, options?: R2MultipartOptions) {
          yield* Effect.logDebug("R2.createMultipartUpload").pipe(
            Effect.annotateLogs({ key })
          );
          return yield* Effect.tryPromise({
            try: () => binding.createMultipartUpload(key, options),
            catch: (cause) =>
              new R2MultipartError({
                operation: "create",
                message: `Failed to create multipart upload for: ${key}`,
                key,
                cause,
              }),
          });
        }
      );

      const resumeMultipartUpload = Effect.fn("R2.resumeMultipartUpload")(
        function* (key: string, uploadId: string) {
          yield* Effect.logDebug("R2.resumeMultipartUpload").pipe(
            Effect.annotateLogs({ key, uploadId })
          );
          return yield* Effect.try({
            try: () => binding.resumeMultipartUpload(key, uploadId),
            catch: (cause) =>
              new R2MultipartError({
                operation: "upload",
                message: `Failed to resume multipart upload for: ${key}`,
                uploadId,
                key,
                cause,
              }),
          });
        }
      );

      return {
        get,
        getOrFail,
        put,
        delete: del,
        head,
        list,
        createMultipartUpload,
        resumeMultipartUpload,
      };
    });

  /**
   * Create a Layer from an R2 binding.
   *
   * This is the standard way to provide R2 service to Effect programs.
   *
   * @param binding - R2 bucket binding from worker environment
   * @returns Layer providing R2 service
   *
   * @example
   * ```ts
   * const layer = R2.layer(env.MY_BUCKET)
   *
   * const program = Effect.gen(function*() {
   *   const r2 = yield* R2
   *   yield* r2.put("upload.txt", "Hello World")
   * }).pipe(Effect.provide(layer))
   * ```
   */
  static layer = (binding: R2Binding) => Layer.effect(this, this.make(binding));

  // ── Task 7.7: Presigned URL generation ────────────────────────────────

  /**
   * Generate an AWS Signature V4 presigned URL for R2 object operations.
   *
   * Presigned URLs allow temporary access to R2 objects without requiring
   * authentication on every request. They are S3-compatible and work with
   * standard HTTP clients.
   *
   * @param config - AWS S3-compatible credentials for R2
   * @param key - Object key to generate URL for
   * @param options - Presigned URL options (operation type, expiry, metadata)
   * @returns Effect yielding presigned URL string
   *
   * @example
   * ```ts
   * const config = {
   *   accessKeyId: "...",
   *   secretAccessKey: "...",
   *   accountId: "...",
   *   bucketName: "my-bucket"
   * }
   *
   * const program = Effect.gen(function*() {
   *   // Generate GET URL (expires in 1 hour)
   *   const getUrl = yield* R2.presign(config, "file.txt", {
   *     operation: "get",
   *     expiresIn: 3600
   *   })
   *
   *   // Generate PUT URL with content type
   *   const putUrl = yield* R2.presign(config, "upload.txt", {
   *     operation: "put",
   *     expiresIn: 300,
   *     httpMetadata: { contentType: "text/plain" }
   *   })
   * })
   * ```
   */
  static presign = (
    config: R2PresignConfig,
    key: string,
    options?: R2PresignOptions & { operation?: "get" | "put" }
  ) =>
    Effect.fn("R2.presign")(function* () {
      const operation = options?.operation ?? "get";
      const expiresIn = options?.expiresIn ?? 3600;
      yield* Effect.logDebug("R2.presign").pipe(
        Effect.annotateLogs({ key, operation, expiresIn })
      );
      const contentType = options?.httpMetadata?.contentType;

      return yield* Effect.tryPromise({
        try: async () => {
          const method = operation === "get" ? "GET" : "PUT";
          return await generatePresignedUrl(config, {
            key,
            method,
            expiresIn,
            ...(contentType !== undefined && { contentType }),
          });
        },
        catch: (cause) =>
          new R2PresignError({
            operation,
            message: `Failed to generate presigned URL for: ${key}`,
            key,
            cause,
          }),
      });
    });
}

// ── AWS Signature V4 Implementation ─────────────────────────────────────

const ALGORITHM = "AWS4-HMAC-SHA256";
const SERVICE = "s3";
const REGION = "auto";

// Helper to convert ArrayBuffer to hex string
const toHex = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

// HMAC-SHA256 using Web Crypto API
const hmacSha256 = async (
  key: ArrayBuffer | Uint8Array,
  message: string
): Promise<ArrayBuffer> => {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const encoder = new TextEncoder();
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
};

// Get signature key for AWS Signature V4
const getSignatureKey = async (
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<ArrayBuffer> => {
  const encoder = new TextEncoder();
  const kDate = await hmacSha256(encoder.encode(`AWS4${secretKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, "aws4_request");
  return kSigning;
};

// SHA256 hash
const sha256Hash = async (message: string): Promise<string> => {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(message));
  return toHex(hash);
};

/**
 * Generate AWS Signature V4 presigned URL for R2.
 * Internal implementation - use R2.presign() instead.
 */
const generatePresignedUrl = async (
  config: R2PresignConfig,
  options: {
    key: string;
    method: "GET" | "PUT" | "DELETE" | "HEAD";
    expiresIn?: number;
    contentType?: string;
  }
): Promise<string> => {
  const { accessKeyId, secretAccessKey, accountId, bucketName } = config;
  const { key, method, expiresIn = 3600, contentType } = options;

  // Generate timestamps
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const amzDate = `${now.toISOString().replace(/[:-]|\..*/g, "")}Z`;

  // Build the canonical request
  const host = `${bucketName}.${accountId}.r2.cloudflarestorage.com`;
  const encodedKey = encodeURIComponent(key).replace(/%2F/g, "/");

  // Build query parameters
  const methodToAction: Record<"GET" | "PUT" | "DELETE" | "HEAD", string> = {
    GET: "GetObject",
    PUT: "PutObject",
    DELETE: "DeleteObject",
    HEAD: "HeadObject",
  };

  const queryParams = new URLSearchParams({
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Credential": `${accessKeyId}/${dateStamp}/${REGION}/${SERVICE}/aws4_request`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": expiresIn.toString(),
    "X-Amz-SignedHeaders": "host",
    "x-id": methodToAction[method],
  });

  // Add content-type to signed headers if provided (for PUT)
  let signedHeaders = "host";
  let canonicalHeaders = `host:${host}\n`;

  if (contentType && method === "PUT") {
    signedHeaders = "content-type;host";
    canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
    queryParams.set("X-Amz-SignedHeaders", signedHeaders);
  }

  // Canonical request components
  const canonicalUri = `/${encodedKey}`;
  const canonicalQueryString = queryParams.toString();
  const payloadHash = "UNSIGNED-PAYLOAD";

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  // Create string to sign
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    await sha256Hash(canonicalRequest),
  ].join("\n");

  // Calculate signature
  const signingKey = await getSignatureKey(
    secretAccessKey,
    dateStamp,
    REGION,
    SERVICE
  );
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  // Build final URL
  const finalUrl = `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;

  return finalUrl;
};

// ── Task 7.9: R2Map LayerMap for Multi-Instance ─────────────────────────

/**
 * R2Map — Multi-instance R2 service using LayerMap.
 *
 * Allows dynamic resolution of multiple R2 buckets by binding name.
 * Useful when you have multiple R2 bindings and need to access them
 * by name at runtime.
 *
 * @example
 * ```ts
 * // Define the R2Map layer (typically in your layer composition)
 * const layers = Layer.mergeAll(
 *   WorkerEnv.layer(env),
 *   R2Map.layer
 * )
 *
 * // Use different R2 buckets dynamically
 * const program = Effect.gen(function*() {
 *   // Access ASSETS_BUCKET
 *   const assetsR2 = yield* R2.pipe(
 *     Effect.provide(R2Map.get("ASSETS_BUCKET"))
 *   )
 *   const asset = yield* assetsR2.get("logo.png")
 *
 *   // Access UPLOADS_BUCKET
 *   const uploadsR2 = yield* R2.pipe(
 *     Effect.provide(R2Map.get("UPLOADS_BUCKET"))
 *   )
 *   yield* uploadsR2.put("user/file.txt", "content")
 * })
 * ```
 */
export class R2Map extends LayerMap.Service<R2Map>()(
  "effectful-cloudflare/R2Map",
  {
    lookup: (name: string) =>
      Layer.effect(
        R2,
        Effect.gen(function* () {
          const env = yield* WorkerEnv;
          const binding = env[name] as R2Binding | undefined;

          if (!binding) {
            return yield* Effect.fail(
              new Errors.BindingError({
                service: "R2",
                message: `R2 binding "${name}" not found in worker environment`,
              })
            );
          }

          return yield* R2.make(binding);
        })
      ),
    idleTimeToLive: "5 minutes",
  }
) {}
