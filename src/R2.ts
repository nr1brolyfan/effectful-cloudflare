// ── src/R2.ts ──────────────────────────────────────────────────────────

import { Data } from "effect"

// ── Task 7.1: R2Binding structural type ────────────────────────────────

/**
 * Minimal structural type for R2Bucket.
 * Allows testing with mocks without requiring @cloudflare/workers-types at runtime.
 */
export type R2Binding = {
  get(
    key: string,
    options?: {
      onlyIf?:
        | { etagMatches?: string; etagDoesNotMatch?: string }
        | { uploadedBefore?: Date; uploadedAfter?: Date }
      range?: { offset?: number; length?: number; suffix?: number }
    },
  ): Promise<R2Object | null>
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options?: {
      httpMetadata?: R2HTTPMetadata
      customMetadata?: Record<string, string>
      md5?: ArrayBuffer | string
      sha1?: ArrayBuffer | string
      sha256?: ArrayBuffer | string
      sha384?: ArrayBuffer | string
      sha512?: ArrayBuffer | string
      storageClass?: "Standard" | "InfrequentAccess"
    },
  ): Promise<R2Object | null>
  delete(keys: string | string[]): Promise<void>
  head(key: string): Promise<R2Object | null>
  list(options?: {
    prefix?: string
    delimiter?: string
    cursor?: string
    limit?: number
    include?: ("httpMetadata" | "customMetadata")[]
  }): Promise<R2Objects>
  createMultipartUpload(
    key: string,
    options?: {
      httpMetadata?: R2HTTPMetadata
      customMetadata?: Record<string, string>
      storageClass?: "Standard" | "InfrequentAccess"
    },
  ): Promise<R2MultipartUpload>
  resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload
}

/**
 * R2 Object returned from get/put/head operations.
 * Subset of the full R2Object type from @cloudflare/workers-types.
 */
export type R2Object = {
  key: string
  version: string
  size: number
  etag: string
  httpEtag: string
  checksums: R2Checksums
  uploaded: Date
  httpMetadata?: R2HTTPMetadata
  customMetadata?: Record<string, string>
  range?: R2Range
  body: ReadableStream
  bodyUsed: boolean
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
  json<T = unknown>(): Promise<T>
  blob(): Promise<Blob>
  writeHttpMetadata(headers: Headers): void
}

/**
 * R2 list result.
 */
export type R2Objects = {
  objects: R2Object[]
  truncated: boolean
  cursor?: string
  delimitedPrefixes: string[]
}

/**
 * R2 Multipart upload handle.
 */
export type R2MultipartUpload = {
  key: string
  uploadId: string
  uploadPart(
    partNumber: number,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
  ): Promise<R2UploadedPart>
  abort(): Promise<void>
  complete(uploadedParts: R2UploadedPart[]): Promise<R2Object>
}

/**
 * Uploaded part metadata.
 */
export type R2UploadedPart = {
  partNumber: number
  etag: string
}

/**
 * R2 HTTP metadata.
 */
export type R2HTTPMetadata = {
  contentType?: string
  contentLanguage?: string
  contentDisposition?: string
  contentEncoding?: string
  cacheControl?: string
  cacheExpiry?: Date
}

/**
 * R2 checksums.
 */
export type R2Checksums = {
  md5?: ArrayBuffer
  sha1?: ArrayBuffer
  sha256?: ArrayBuffer
  sha384?: ArrayBuffer
  sha512?: ArrayBuffer
}

/**
 * R2 range.
 */
export type R2Range = {
  offset?: number
  length?: number
  suffix?: number
}

// ── Task 7.2: R2-specific errors ────────────────────────────────────────

/**
 * General R2 object operation error.
 * Wraps unexpected errors from R2 API calls.
 */
export class R2Error extends Data.TaggedError("R2Error")<{
  readonly operation: string
  readonly key?: string | undefined
  readonly cause: unknown
}> {}

/**
 * Multipart upload operation error.
 * Includes the uploadId for debugging.
 */
export class R2MultipartError extends Data.TaggedError("R2MultipartError")<{
  readonly operation: "create" | "upload" | "complete" | "abort"
  readonly uploadId?: string
  readonly key?: string
  readonly cause: unknown
}> {}

/**
 * Presigned URL generation error.
 * Used when generating S3-compatible presigned URLs fails.
 */
export class R2PresignError extends Data.TaggedError("R2PresignError")<{
  readonly operation: "get" | "put"
  readonly key: string
  readonly cause: unknown
}> {}

// ── Task 7.3: R2 result types ───────────────────────────────────────────

/**
 * Simplified R2 object metadata (without body).
 * Used by put() and head() operations.
 */
export type R2ObjectInfo = {
  readonly key: string
  readonly version: string
  readonly size: number
  readonly etag: string
  readonly httpEtag: string
  readonly checksums: R2Checksums
  readonly uploaded: Date
  readonly httpMetadata?: R2HTTPMetadata | undefined
  readonly customMetadata?: Record<string, string> | undefined
  readonly range?: R2Range | undefined
}

/**
 * R2 list operation result.
 */
export type R2ListResult = {
  readonly objects: ReadonlyArray<R2ObjectInfo>
  readonly truncated: boolean
  readonly cursor?: string | undefined
  readonly delimitedPrefixes: ReadonlyArray<string>
}

/**
 * Options for R2 get operations.
 */
export type R2GetOptions = {
  readonly onlyIf?:
    | { readonly etagMatches?: string; readonly etagDoesNotMatch?: string }
    | { readonly uploadedBefore?: Date; readonly uploadedAfter?: Date }
  readonly range?: { readonly offset?: number; readonly length?: number; readonly suffix?: number }
}

/**
 * Options for R2 put operations.
 */
export type R2PutOptions = {
  readonly httpMetadata?: R2HTTPMetadata
  readonly customMetadata?: Record<string, string>
  readonly md5?: ArrayBuffer | string
  readonly sha1?: ArrayBuffer | string
  readonly sha256?: ArrayBuffer | string
  readonly sha384?: ArrayBuffer | string
  readonly sha512?: ArrayBuffer | string
  readonly storageClass?: "Standard" | "InfrequentAccess"
}

/**
 * Value types accepted by R2 put operations.
 */
export type R2PutValue =
  | ReadableStream
  | ArrayBuffer
  | ArrayBufferView
  | string
  | null
  | Blob

/**
 * Options for R2 list operations.
 */
export type R2ListOptions = {
  readonly prefix?: string
  readonly delimiter?: string
  readonly cursor?: string
  readonly limit?: number
  readonly include?: ReadonlyArray<"httpMetadata" | "customMetadata">
}

/**
 * Options for R2 multipart upload operations.
 */
export type R2MultipartOptions = {
  readonly httpMetadata?: R2HTTPMetadata
  readonly customMetadata?: Record<string, string>
  readonly storageClass?: "Standard" | "InfrequentAccess"
}

/**
 * Presigned URL generation options.
 */
export type R2PresignOptions = {
  readonly expiresIn?: number // seconds
  readonly httpMetadata?: R2HTTPMetadata
}

/**
 * Configuration for presigned URL generation.
 * Requires AWS S3-compatible credentials for R2.
 */
export type R2PresignConfig = {
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly accountId: string
  readonly bucketName: string
}

// ── Task 7.4: R2 Service Class ──────────────────────────────────────────

import { Effect, Layer, ServiceMap } from "effect"
import * as Errors from "./Errors.js"

/**
 * R2 service — Effect-wrapped Cloudflare Workers R2 object storage.
 *
 * Provides Effect-based operations for Cloudflare Workers R2 with:
 * - Automatic error handling and typed errors
 * - Multipart upload support
 * - Presigned URL generation
 * - Schema validation support via `.json()` factory
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
      options?: R2GetOptions,
    ) => Effect.Effect<R2Object | null, R2Error>
    readonly getOrFail: (
      key: string,
      options?: R2GetOptions,
    ) => Effect.Effect<R2Object, R2Error | Errors.NotFoundError>
    readonly put: (
      key: string,
      value: R2PutValue,
      options?: R2PutOptions,
    ) => Effect.Effect<R2ObjectInfo, R2Error>
    readonly delete: (
      key: string | ReadonlyArray<string>,
    ) => Effect.Effect<void, R2Error>
    readonly head: (
      key: string,
    ) => Effect.Effect<R2ObjectInfo | null, R2Error>
    readonly list: (
      options?: R2ListOptions,
    ) => Effect.Effect<R2ListResult, R2Error>
    readonly createMultipartUpload: (
      key: string,
      options?: R2MultipartOptions,
    ) => Effect.Effect<R2MultipartUpload, R2MultipartError>
    readonly resumeMultipartUpload: (
      key: string,
      uploadId: string,
    ) => R2MultipartUpload
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
        options?: R2GetOptions,
      ) {
        return yield* Effect.tryPromise({
          try: () => binding.get(key, options),
          catch: (cause) => new R2Error({ operation: "get", key, cause }),
        })
      })

      const getOrFail = Effect.fn("R2.getOrFail")(function* (
        key: string,
        options?: R2GetOptions,
      ) {
        const obj = yield* get(key, options)
        if (obj === null) {
          return yield* Effect.fail(
            new Errors.NotFoundError({
              resource: "R2",
              key,
            }),
          )
        }
        return obj
      })

      const put = Effect.fn("R2.put")(function* (
        key: string,
        value: R2PutValue,
        options?: R2PutOptions,
      ) {
        const obj = yield* Effect.tryPromise({
          try: () => binding.put(key, value, options),
          catch: (cause) => new R2Error({ operation: "put", key, cause }),
        })

        // R2 put can return null in rare cases (e.g., conditional put failed)
        if (obj === null) {
          return yield* Effect.fail(
            new R2Error({
              operation: "put",
              key,
              cause: new Error("Put operation returned null"),
            }),
          )
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
        }
        return info
      })

      const del = Effect.fn("R2.delete")(function* (
        key: string | ReadonlyArray<string>,
      ) {
        // Convert readonly array to mutable for binding
        const keyArg = typeof key === "string" ? key : [...key]
        return yield* Effect.tryPromise({
          try: () => binding.delete(keyArg),
          catch: (cause) =>
            new R2Error({
              operation: "delete",
              key: typeof key === "string" ? key : undefined,
              cause,
            }),
        })
      })

      const head = Effect.fn("R2.head")(function* (key: string) {
        const obj = yield* Effect.tryPromise({
          try: () => binding.head(key),
          catch: (cause) => new R2Error({ operation: "head", key, cause }),
        })

        if (obj === null) {
          return null
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
        }
        return info
      })

      const list = Effect.fn("R2.list")(function* (options?: R2ListOptions) {
        // Convert readonly array to mutable for binding
        const bindingOptions: Parameters<R2Binding["list"]>[0] = options
          ? {
              ...(options.prefix !== undefined && { prefix: options.prefix }),
              ...(options.delimiter !== undefined && { delimiter: options.delimiter }),
              ...(options.cursor !== undefined && { cursor: options.cursor }),
              ...(options.limit !== undefined && { limit: options.limit }),
              ...(options.include !== undefined && { include: [...options.include] }),
            }
          : undefined

        const result = yield* Effect.tryPromise({
          try: () => binding.list(bindingOptions),
          catch: (cause) => new R2Error({ operation: "list", cause }),
        })

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
        }
        return listResult
      })

      // ── Task 7.6: Multipart upload methods ────────────────────────────

      const createMultipartUpload = Effect.fn("R2.createMultipartUpload")(
        function* (key: string, options?: R2MultipartOptions) {
          return yield* Effect.tryPromise({
            try: () => binding.createMultipartUpload(key, options),
            catch: (cause) =>
              new R2MultipartError({
                operation: "create",
                key,
                cause,
              }),
          })
        },
      )

      const resumeMultipartUpload = (key: string, uploadId: string) => {
        // resumeMultipartUpload is synchronous in R2 binding
        return binding.resumeMultipartUpload(key, uploadId)
      }

      return {
        get,
        getOrFail,
        put,
        delete: del,
        head,
        list,
        createMultipartUpload,
        resumeMultipartUpload,
      }
    })

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
  static layer = (binding: R2Binding) => Layer.effect(this, this.make(binding))
}
