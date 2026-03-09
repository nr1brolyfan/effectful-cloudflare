// Comprehensive type compatibility test
// Each assignment tests if CF's native type is assignable to our binding type

import type { AIBinding } from "./AI.js";
import type { AIGatewayBinding } from "./AIGateway.js";
import type { CacheBinding } from "./Cache.js";
import type { D1Binding } from "./D1.js";
import type { DONamespaceBinding, DOStorageBinding } from "./DurableObject.js";
import type { HyperdriveBinding } from "./Hyperdrive.js";
import type { KVBinding } from "./KV.js";
import type { QueueBinding } from "./Queue.js";
import type { R2Binding } from "./R2.js";
import type { VectorizeBinding } from "./Vectorize.js";

declare const _cfVectorize: VectorizeIndex;
declare const _cfKV: KVNamespace;
declare const _cfD1: D1Database;
declare const _cfR2: R2Bucket;
declare const _cfQueue: Queue;
declare const _cfAI: Ai;
declare const _cfAIGW: AiGateway;
declare const _cfCache: Cache;
declare const _cfHD: Hyperdrive;
declare const _cfDONS: DurableObjectNamespace;
declare const _cfDOStorage: DurableObjectStorage;

// Test each one individually:
export const testVectorize: VectorizeBinding = _cfVectorize;
export const testKV: KVBinding = _cfKV;
export const testD1: D1Binding = _cfD1;
export const testR2: R2Binding = _cfR2;
export const testQueue: QueueBinding = _cfQueue;
export const testAI: AIBinding = _cfAI;
export const testAIGW: AIGatewayBinding = _cfAIGW;
export const testCache: CacheBinding = _cfCache;
export const testHD: HyperdriveBinding = _cfHD;
export const testDONS: DONamespaceBinding = _cfDONS;
export const testDOStorage: DOStorageBinding = _cfDOStorage;
