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
  readonly key?: string
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
  readonly httpMetadata?: R2HTTPMetadata
  readonly customMetadata?: Record<string, string>
  readonly range?: R2Range
}

/**
 * R2 list operation result.
 */
export type R2ListResult = {
  readonly objects: ReadonlyArray<R2ObjectInfo>
  readonly truncated: boolean
  readonly cursor?: string
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
