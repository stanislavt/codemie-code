/**
 * Protobuf encode/decode for the CodeMie NATS plugin protocol — zero dependencies.
 *
 * Hand-written implementation of the service.proto schema using the protobuf
 * binary wire format directly. No .proto file or protobufjs needed.
 *
 * Protobuf wire format cheat-sheet used here:
 *   - Wire type 0 (VARINT)            : enums, int32
 *   - Wire type 2 (LENGTH_DELIMITED)  : strings, embedded messages
 *   - Field tag = (field_number << 3) | wire_type
 *   - Proto3: fields with default value (0 / "") are NOT encoded on the wire
 *
 * Schema (from proto/v1/service.proto):
 *
 *   enum Handler  { GET = 0; RUN = 1; }
 *   enum Puppet   { LANGCHAIN_TOOL = 0; }
 *
 *   LangChainTool { name?=1 description?=2 args_schema?=3 result?=4 error?=5 query?=6 }
 *   ServiceMeta   { subject=1  handler=2  puppet=3 }
 *   PuppetRequest { lc_tool=1 }   PuppetResponse { lc_tool=1 }
 *   ServiceRequest  { meta=1  puppet_request=2  }
 *   ServiceResponse { meta=1  puppet_response=2  error=3 }
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export const Handler = { GET: 0, RUN: 1 } as const;
export const Puppet = { LANGCHAIN_TOOL: 0 } as const;

export interface ILangChainTool {
  name?: string;
  description?: string;
  args_schema?: string;
  result?: string;
  error?: string;
  query?: string;
}

export interface IServiceMeta {
  subject: string;
  handler: number;
  puppet: number;
}

export interface IServiceRequest {
  meta?: IServiceMeta;
  puppet_request?: { lc_tool?: ILangChainTool };
}

export interface IServiceResponse {
  meta?: IServiceMeta;
  puppet_response?: { lc_tool?: ILangChainTool };
  error?: string;
}

// ---------------------------------------------------------------------------
// Wire-format primitives
// ---------------------------------------------------------------------------

const WIRE_VARINT = 0;
const WIRE_LEN = 2;
const enc = new TextEncoder();
const dec = new TextDecoder();

function tag(field: number, wire: number): number {
  return (field << 3) | wire;
}

/** Encode a non-negative integer as a varint. */
function varint(n: number): Uint8Array {
  const out: number[] = [];
  let v = n >>> 0; // treat as unsigned 32-bit
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return new Uint8Array(out);
}

/** Read one varint from buf[offset], returns [value, bytesConsumed]. */
function readVarint(buf: Uint8Array, offset: number): [number, number] {
  let value = 0, shift = 0, i = offset;
  while (i < buf.length) {
    const b = buf[i++]!;
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return [value >>> 0, i - offset];
}

/** Concatenate multiple Uint8Array segments. */
function cat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

// ---------------------------------------------------------------------------
// Field encoders
// ---------------------------------------------------------------------------

/** Encode a string field (wire type 2). Skipped if value is empty. */
function strField(fieldNum: number, value: string | undefined): Uint8Array {
  if (!value) return new Uint8Array(0);
  const bytes = enc.encode(value);
  return cat(varint(tag(fieldNum, WIRE_LEN)), varint(bytes.length), bytes);
}

/** Encode an enum/int32 field (wire type 0). Skipped if value is 0 (proto3 default). */
function intField(fieldNum: number, value: number): Uint8Array {
  if (value === 0) return new Uint8Array(0);
  return cat(varint(tag(fieldNum, WIRE_VARINT)), varint(value));
}

/** Encode an embedded message field (wire type 2). Skipped if empty. */
function msgField(fieldNum: number, bytes: Uint8Array): Uint8Array {
  if (bytes.length === 0) return new Uint8Array(0);
  return cat(varint(tag(fieldNum, WIRE_LEN)), varint(bytes.length), bytes);
}

// ---------------------------------------------------------------------------
// Message encoders
// ---------------------------------------------------------------------------

function encodeLangChainTool(t: ILangChainTool): Uint8Array {
  return cat(
    strField(1, t.name),
    strField(2, t.description),
    strField(3, t.args_schema),
    strField(4, t.result),
    strField(5, t.error),
    strField(6, t.query),
  );
}

function encodeServiceMeta(m: IServiceMeta): Uint8Array {
  return cat(
    strField(1, m.subject),
    intField(2, m.handler),
    intField(3, m.puppet),
  );
}

function encodeServiceResponse(r: IServiceResponse): Uint8Array {
  const metaBytes = r.meta ? encodeServiceMeta(r.meta) : new Uint8Array(0);
  const respBytes = r.puppet_response?.lc_tool
    ? msgField(1, encodeLangChainTool(r.puppet_response.lc_tool))
    : new Uint8Array(0);

  return cat(
    msgField(1, metaBytes),
    msgField(2, respBytes),
    strField(3, r.error),
  );
}

// ---------------------------------------------------------------------------
// Message decoder
// ---------------------------------------------------------------------------

/** Decode raw protobuf bytes into a flat map of fieldNumber → raw value. */
function decodeFields(buf: Uint8Array): Map<number, Array<number | Uint8Array>> {
  const fields = new Map<number, Array<number | Uint8Array>>();
  let offset = 0;

  while (offset < buf.length) {
    const [t, tLen] = readVarint(buf, offset);
    offset += tLen;
    const fieldNum = t >> 3;
    const wireType = t & 0x7;

    if (wireType === WIRE_VARINT) {
      const [v, vLen] = readVarint(buf, offset);
      offset += vLen;
      const arr = fields.get(fieldNum) ?? [];
      arr.push(v);
      fields.set(fieldNum, arr);
    } else if (wireType === WIRE_LEN) {
      const [len, lLen] = readVarint(buf, offset);
      offset += lLen;
      const bytes = buf.slice(offset, offset + len);
      offset += len;
      const arr = fields.get(fieldNum) ?? [];
      arr.push(bytes);
      fields.set(fieldNum, arr);
    } else {
      // Unknown wire type — skip; shouldn't happen with our schema
      break;
    }
  }
  return fields;
}

function getBytes(fields: Map<number, Array<number | Uint8Array>>, fieldNum: number): Uint8Array | undefined {
  const v = fields.get(fieldNum)?.[0];
  return v instanceof Uint8Array ? v : undefined;
}

function getStr(fields: Map<number, Array<number | Uint8Array>>, fieldNum: number): string | undefined {
  const b = getBytes(fields, fieldNum);
  return b ? dec.decode(b) : undefined;
}

function getInt(fields: Map<number, Array<number | Uint8Array>>, fieldNum: number): number {
  const v = fields.get(fieldNum)?.[0];
  return typeof v === 'number' ? v : 0;
}

function decodeLangChainTool(buf: Uint8Array): ILangChainTool {
  const f = decodeFields(buf);
  return {
    name:        getStr(f, 1),
    description: getStr(f, 2),
    args_schema: getStr(f, 3),
    result:      getStr(f, 4),
    error:       getStr(f, 5),
    query:       getStr(f, 6),
  };
}

function decodeServiceMeta(buf: Uint8Array): IServiceMeta {
  const f = decodeFields(buf);
  return {
    subject: getStr(f, 1) ?? '',
    handler: getInt(f, 2),
    puppet:  getInt(f, 3),
  };
}

function decodeServiceRequest(buf: Uint8Array): IServiceRequest {
  const f = decodeFields(buf);
  const metaBytes = getBytes(f, 1);
  const reqBytes  = getBytes(f, 2);

  let puppetRequest: IServiceRequest['puppet_request'];
  if (reqBytes) {
    const rf = decodeFields(reqBytes);
    const lcBytes = getBytes(rf, 1);
    puppetRequest = { lc_tool: lcBytes ? decodeLangChainTool(lcBytes) : undefined };
  }

  return {
    meta:           metaBytes ? decodeServiceMeta(metaBytes) : undefined,
    puppet_request: puppetRequest,
  };
}

// ---------------------------------------------------------------------------
// Public API — same surface as the old protobufjs version
// ---------------------------------------------------------------------------

export { encodeServiceResponse, decodeServiceRequest };
