// ── src/R2.ts ──────────────────────────────────────────────────────────

import { Data, Schema } from "effect"

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

import { Effect, Layer, LayerMap, ServiceMap } from "effect"
import * as Errors from "./Errors.js"
import { WorkerEnv } from "./Worker.js"

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
    options?: R2PresignOptions & { operation?: "get" | "put" },
  ) =>
    Effect.fn("R2.presign")(function* () {
      const operation = options?.operation ?? "get"
      const expiresIn = options?.expiresIn ?? 3600
      const contentType = options?.httpMetadata?.contentType

      return yield* Effect.tryPromise({
        try: async () => {
          const method = operation === "get" ? "GET" : "PUT"
          return await generatePresignedUrl(config, {
            key,
            method,
            expiresIn,
            ...(contentType !== undefined && { contentType }),
          })
        },
        catch: (cause) =>
          new R2PresignError({
            operation,
            key,
            cause,
          }),
      })
    })

  // ── Task 7.8: R2.json(schema) factory ──────────────────────────────────

  /**
   * Create schema-validated R2 variant (JSON mode).
   *
   * Returns a factory with `make` and `layer` methods that automatically:
   * - Encode values to JSON before storing
   * - Decode JSON values after retrieval
   * - Validate against the provided schema
   * - Add `SchemaError` to the error channel
   * - Set `Content-Type: application/json` on put operations
   *
   * @param schema - Schema.Schema for encoding/decoding values
   * @returns Factory with `make` and `layer` methods
   *
   * @example
   * ```ts
   * const UserSchema = Schema.Struct({
   *   id: Schema.String,
   *   name: Schema.String,
   *   email: Schema.String,
   * })
   * type User = Schema.Schema.Type<typeof UserSchema>
   *
   * const userR2 = R2.json(UserSchema)
   * const layer = userR2.layer(env.USERS_BUCKET)
   *
   * const program = Effect.gen(function*() {
   *   const r2 = yield* R2
   *   // Fully typed - returns User | null
   *   const user = yield* r2.get("user/123.json")
   *   // Fully typed - accepts User
   *   yield* r2.put("user/456.json", { id: "456", name: "Bob", email: "bob@x.com" })
   * }).pipe(Effect.provide(layer))
   * ```
   */
  static json = <A>(schema: Schema.Schema<A>) => ({
    make: (binding: R2Binding) =>
      Effect.gen(function* () {
        const baseR2 = yield* R2.make(binding)

        const get = Effect.fn("R2.json.get")(function* (
          key: string,
          options?: R2GetOptions,
        ) {
          const obj = yield* baseR2.get(key, options)
          if (obj === null) {
            return null as A | null
          }

          const text = yield* Effect.tryPromise({
            try: () => obj.text(),
            catch: (cause) =>
              new R2Error({
                operation: "get",
                key,
                cause,
              }),
          })

          const parsed = yield* Effect.try({
            try: () => JSON.parse(text),
            catch: (cause) =>
              new Errors.SchemaError({
                message: `Failed to parse JSON for key "${key}"`,
                cause: cause as Error,
              }),
          })

          return yield* Schema.decodeUnknownEffect(schema)(parsed).pipe(
            Effect.mapError(
              (cause) =>
                new Errors.SchemaError({
                  message: `Schema validation failed for key "${key}"`,
                  cause: cause as Error,
                }),
            ),
          )
        })

        const getOrFail = Effect.fn("R2.json.getOrFail")(function* (
          key: string,
          options?: R2GetOptions,
        ) {
          const value = yield* get(key, options)
          if (value === null) {
            return yield* Effect.fail(
              new Errors.NotFoundError({
                resource: "R2",
                key,
              }),
            )
          }
          return value
        })

        const put = Effect.fn("R2.json.put")(function* (
          key: string,
          value: A,
          options?: R2PutOptions,
        ) {
          const encoded = yield* Schema.encodeEffect(schema)(value).pipe(
            Effect.mapError(
              (cause) =>
                new Errors.SchemaError({
                  message: `Schema encoding failed for key "${key}"`,
                  cause: cause as Error,
                }),
            ),
          )

          const json = yield* Effect.try({
            try: () => JSON.stringify(encoded),
            catch: (cause) =>
              new Errors.SchemaError({
                message: `Failed to stringify JSON for key "${key}"`,
                cause: cause as Error,
              }),
          })

          return yield* baseR2.put(key, json, {
            ...options,
            httpMetadata: {
              contentType: "application/json",
              ...options?.httpMetadata,
            },
          })
        })

        // Return service with typed methods
        // Note: This object is structurally compatible with R2 service,
        // but uses generic type A instead of R2Object/R2PutValue for values.
        return {
          get,
          getOrFail,
          put,
          delete: baseR2.delete,
          head: baseR2.head,
          list: baseR2.list,
          createMultipartUpload: baseR2.createMultipartUpload,
          resumeMultipartUpload: baseR2.resumeMultipartUpload,
        }
      }),
    layer: (binding: R2Binding) =>
      Layer.effect(
        R2,
        // Type assertion is safe: we provide an R2-compatible service with
        // schema-validated types (A instead of R2Object). The Layer system
        // handles this correctly at runtime since the shape is identical.
        R2.json(schema).make(binding) as unknown as ReturnType<typeof R2.make>,
      ),
  })
}

// ── AWS Signature V4 Implementation ─────────────────────────────────────

const ALGORITHM = "AWS4-HMAC-SHA256"
const SERVICE = "s3"
const REGION = "auto"

// Helper to convert ArrayBuffer to hex string
const toHex = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

// HMAC-SHA256 using Web Crypto API
const hmacSha256 = async (
  key: ArrayBuffer | Uint8Array,
  message: string,
): Promise<ArrayBuffer> => {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const encoder = new TextEncoder()
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message))
}

// Get signature key for AWS Signature V4
const getSignatureKey = async (
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<ArrayBuffer> => {
  const encoder = new TextEncoder()
  const kDate = await hmacSha256(
    encoder.encode(`AWS4${secretKey}`),
    dateStamp,
  )
  const kRegion = await hmacSha256(kDate, region)
  const kService = await hmacSha256(kRegion, service)
  const kSigning = await hmacSha256(kService, "aws4_request")
  return kSigning
}

// SHA256 hash
const sha256Hash = async (message: string): Promise<string> => {
  const encoder = new TextEncoder()
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(message))
  return toHex(hash)
}

/**
 * Generate AWS Signature V4 presigned URL for R2.
 * Internal implementation - use R2.presign() instead.
 */
const generatePresignedUrl = async (
  config: R2PresignConfig,
  options: {
    key: string
    method: "GET" | "PUT" | "DELETE" | "HEAD"
    expiresIn?: number
    contentType?: string
  },
): Promise<string> => {
  const { accessKeyId, secretAccessKey, accountId, bucketName } = config
  const { key, method, expiresIn = 3600, contentType } = options

  // Generate timestamps
  const now = new Date()
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "")
  const amzDate =
    now.toISOString().replace(/[:-]|\..*/g, "") + "Z"

  // Build the canonical request
  const host = `${bucketName}.${accountId}.r2.cloudflarestorage.com`
  const encodedKey = encodeURIComponent(key).replace(/%2F/g, "/")

  // Build query parameters
  const queryParams = new URLSearchParams({
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Credential": `${accessKeyId}/${dateStamp}/${REGION}/${SERVICE}/aws4_request`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": expiresIn.toString(),
    "X-Amz-SignedHeaders": "host",
    "x-id":
      method === "GET"
        ? "GetObject"
        : method === "PUT"
          ? "PutObject"
          : method === "DELETE"
            ? "DeleteObject"
            : "HeadObject",
  })

  // Add content-type to signed headers if provided (for PUT)
  let signedHeaders = "host"
  let canonicalHeaders = `host:${host}\n`

  if (contentType && method === "PUT") {
    signedHeaders = "content-type;host"
    canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`
    queryParams.set("X-Amz-SignedHeaders", signedHeaders)
  }

  // Canonical request components
  const canonicalUri = `/${encodedKey}`
  const canonicalQueryString = queryParams.toString()
  const payloadHash = "UNSIGNED-PAYLOAD"

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n")

  // Create string to sign
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`
  const stringToSign = [
    ALGORITHM,
    amzDate,
    credentialScope,
    await sha256Hash(canonicalRequest),
  ].join("\n")

  // Calculate signature
  const signingKey = await getSignatureKey(
    secretAccessKey,
    dateStamp,
    REGION,
    SERVICE,
  )
  const signature = toHex(await hmacSha256(signingKey, stringToSign))

  // Build final URL
  const finalUrl = `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`

  return finalUrl
}

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
          const env = yield* WorkerEnv
          const binding = env[name] as R2Binding
          return yield* R2.make(binding)
        }),
      ),
    idleTimeToLive: "5 minutes",
  },
) {}
