/**
 * POST /api/ppe — PPE (headwear) compliance assessment for a single frame.
 *
 * Accepts a raw `image/*` body and asks a multimodal vision model whether each
 * visible person is wearing the requested headwear (a hardhat or a baseball
 * cap). Unlike `/api/detect` (which returns geometric boxes), this route asks
 * the model to *reason* about the scene and return structured JSON.
 *
 * Three models are selectable via the `?model=` query param so you can compare
 * quality/latency/cost trade-offs:
 *   - llama → @cf/meta/llama-3.2-11b-vision-instruct (chat + image)
 *   - llava → @cf/llava-hf/llava-1.5-7b-hf           (image + single prompt)
 *   - gemma → @cf/google/gemma-4-26b-a4b-it          (chat + image)
 *
 * Because vision models are slower than DETR, the `/ppe` view calls this route
 * on a slow cadence (every few seconds) while DETR keeps person boxes snappy.
 *
 * @see https://developers.cloudflare.com/workers-ai/
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

// Server-render on every request (this is a dynamic API endpoint, not a page).
export const prerender = false;

/** Selectable model keys exposed to the client via `?model=`. */
type ModelKey = 'llama' | 'llava' | 'gemma';
/** Selectable detection targets exposed to the client via `?target=`. */
type TargetKey = 'hardhat' | 'baseball-cap';

/** Structured result we ask the vision model to produce (and then validate). */
type PPEAssessment = {
	/** How many people the model sees in the frame. */
	person_count: number;
	/** One entry per visible person. */
	persons: Array<{
		/** True if the person is wearing the requested headwear. */
		wearing_target: boolean;
		/** Human-readable position, e.g. "left foreground". */
		location: string;
	}>;
};

/** Maps the short client key to the fully-qualified Workers AI model ID. */
const MODELS: Record<ModelKey, string> = {
	llama: '@cf/meta/llama-3.2-11b-vision-instruct',
	llava: '@cf/llava-hf/llava-1.5-7b-hf',
	gemma: '@cf/google/gemma-4-26b-a4b-it',
};

/** Per-target prompt vocabulary so the same code can check different headwear. */
const TARGETS: Record<TargetKey, { label: string; item: string; examples: string }> = {
	'hardhat': {
		label: 'hardhat',
		item: 'a hardhat or safety helmet',
		examples: 'construction hardhat, safety helmet, protective helmet',
	},
	'baseball-cap': {
		label: 'baseball cap',
		item: 'a baseball cap',
		examples: 'baseball cap, brimmed ball cap, casual cap',
	},
};

const systemPrompt = 'You are a construction safety vision assistant. Return only valid JSON.';

/**
 * Build the user prompt for a given target. We are very explicit about the
 * required JSON shape because small vision models tend to add prose or markdown
 * fences otherwise — `parseAssessment` below has to defend against that.
 */
const makeUserPrompt = (target: (typeof TARGETS)[TargetKey]) => `Analyze this live video frame for headwear compliance.
Detect visible people and decide whether each person is wearing ${target.item}.
Return VALID JSON only, with no prose and no markdown fences, in exactly this shape:
{"person_count":0,"persons":[]}
If people are visible, populate persons with objects like:
{"wearing_target":true,"location":"left foreground"}
Use false when ${target.item} is not visible or cannot be confidently confirmed.
Valid positive examples include: ${target.examples}.
Do not count other headwear as compliant unless it clearly matches ${target.item}.`;

/** JSON response helper (see the matching helper in detect.ts). */
const json = (body: unknown, init?: ResponseInit) =>
	new Response(JSON.stringify(body), {
		...init,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'no-store',
			...init?.headers,
		},
	});

/**
 * Thin wrapper around `env.AI.run`. The Workers AI types are per-model and very
 * strict; this demo intentionally passes model-specific input shapes, so we
 * cast to a loose signature to keep one call site for all three models.
 */
const runAI = (model: string, input: unknown) =>
	(env.AI.run as unknown as (model: string, input: unknown) => Promise<unknown>)(model, input);

/**
 * Handle a PPE assessment request.
 *
 * Query params:
 *   - `model`  one of `llama` | `llava` | `gemma` (defaults to `llama`)
 *   - `target` one of `hardhat` | `baseball-cap` (defaults to `hardhat`)
 *
 * Returns `{ assessment, raw, inferenceMs, bytes, model, modelKey, targetKey,
 * target }`. `assessment` is the validated structured result (or `null` if the
 * model's output could not be parsed); `raw` is the model's raw text for
 * debugging in the UI.
 */
export const POST: APIRoute = async ({ request, url }) => {
	const contentType = request.headers.get('content-type') ?? '';
	if (!contentType.startsWith('image/')) {
		return json({ error: 'Send a raw image/* request body.' }, { status: 415 });
	}

	// Resolve and validate the requested model/target, falling back to defaults
	// if the client sends something unknown.
	const requestedModel = url.searchParams.get('model') as ModelKey | null;
	const modelKey: ModelKey = requestedModel && requestedModel in MODELS ? requestedModel : 'llama';
	const requestedTarget = url.searchParams.get('target') as TargetKey | null;
	const targetKey: TargetKey = requestedTarget && requestedTarget in TARGETS ? requestedTarget : 'hardhat';
	const target = TARGETS[targetKey];
	const model = MODELS[modelKey];
	const image = await request.arrayBuffer();

	if (image.byteLength === 0) {
		return json({ error: 'Image body is empty.' }, { status: 400 });
	}

	// Two encodings of the same image: a byte array (LLaVA) and a base64 data
	// URL (Llama / Gemma chat models). We compute both up front.
	const imageBytes = [...new Uint8Array(image)];
	const imageDataUrl = `data:${contentType};base64,${arrayBufferToBase64(image)}`;
	const started = Date.now();

	try {
		const rawResult = await runPPEModel(modelKey, model, imageBytes, imageDataUrl, makeUserPrompt(target));
		const raw = extractText(rawResult);
		const assessment = parseAssessment(raw);

		return json({
			assessment,
			raw,
			inferenceMs: Date.now() - started,
			bytes: image.byteLength,
			model,
			modelKey,
			targetKey,
			target: target.label,
		});
	} catch (error) {
		return json(
			{
				error: error instanceof Error ? error.message : 'PPE assessment failed.',
				model,
				modelKey,
				targetKey,
			},
			{ status: 500 }
		);
	}
};

/**
 * Run the selected model with the input shape it expects.
 *
 * LLaVA takes `{ image: number[], prompt }`. The chat models (Llama, Gemma)
 * take `{ messages, image: dataURL }`.
 *
 * Llama 3.2 Vision requires a one-time, per-account license agreement before it
 * will serve requests. The first call may fail with a license error; we detect
 * that, POST `{ prompt: 'agree' }` to accept, then retry the original request.
 */
async function runPPEModel(
	modelKey: ModelKey,
	model: string,
	imageBytes: number[],
	imageDataUrl: string,
	userPrompt: string
) {
	if (modelKey === 'llava') {
		return runAI(model, {
			image: imageBytes,
			prompt: `${systemPrompt}\n${userPrompt}`,
			max_tokens: 512,
		});
	}

	const input = {
		messages: [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt },
		],
		image: imageDataUrl,
	};

	if (modelKey === 'llama') {
		try {
			return await runAI(model, input);
		} catch (error) {
			// Only auto-accept the license; re-throw anything else.
			if (!isLicenseAgreementError(error)) throw error;
			await runAI(model, { prompt: 'agree' });
			return runAI(model, input);
		}
	}

	return runAI(model, input);
}

/**
 * Convert an ArrayBuffer to a base64 string in fixed-size chunks.
 *
 * We chunk because `String.fromCharCode(...bytes)` spreads every byte as a
 * function argument; on a full-frame image that can blow the call-stack arg
 * limit. 8 KB chunks stay well under it.
 */
function arrayBufferToBase64(buffer: ArrayBuffer) {
	let binary = '';
	const bytes = new Uint8Array(buffer);
	const chunkSize = 8192;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}
	return btoa(binary);
}

/**
 * Pull a text payload out of whatever shape the model returned. Different
 * Workers AI models wrap their output differently (`response`, `description`,
 * OpenAI-style `choices[].message.content`, or a bare string), so we probe the
 * common keys in turn and fall back to stringifying the whole object.
 */
function extractText(result: unknown): string {
	if (typeof result === 'string') return result;
	if (!result || typeof result !== 'object') return '';
	const record = result as Record<string, unknown>;
	for (const key of ['response', 'description', 'text', 'result']) {
		if (typeof record[key] === 'string') return record[key] as string;
		if (record[key] && typeof record[key] === 'object') return JSON.stringify(record[key]);
	}
	const choices = record.choices;
	if (Array.isArray(choices)) {
		const first = choices[0] as Record<string, unknown> | undefined;
		const message = first?.message as Record<string, unknown> | undefined;
		if (typeof message?.content === 'string') return message.content;
		if (typeof first?.text === 'string') return first.text;
	}
	return JSON.stringify(result);
}

/**
 * Parse and normalize the model's text into a trusted `PPEAssessment`.
 *
 * Defensive on purpose — model output is untrusted:
 *  1. strip markdown code fences,
 *  2. extract the first `{...}` block,
 *  3. JSON.parse and locate the assessment (it may be nested),
 *  4. coerce `person_count` to a non-negative integer and each person's flag to
 *     a boolean (accepting the older `wearing_hardhat` key for compatibility).
 *
 * @returns the normalized assessment, or `null` if nothing usable was found.
 */
function parseAssessment(raw: string): PPEAssessment | null {
	const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
	const match = cleaned.match(/\{[\s\S]*\}/);
	if (!match) return null;

	try {
		const parsed = findAssessment(JSON.parse(match[0]));
		if (!parsed) return null;
		return {
			person_count: Math.max(0, Math.round(Number(parsed.person_count))),
			persons: parsed.persons.map((person) => ({
				wearing_target: Boolean(person?.wearing_target ?? person?.wearing_hardhat),
				location: typeof person?.location === 'string' ? person.location : 'visible person',
			})),
		};
	} catch {
		return null;
	}
}

/**
 * Recursively locate the assessment object. A valid one has a numeric
 * `person_count` and an array `persons`; some models nest it under `response`,
 * `assessment`, or `result`.
 */
function findAssessment(value: unknown): Partial<PPEAssessment> | null {
	if (!value || typeof value !== 'object') return null;
	const record = value as Record<string, unknown>;

	if (Number.isFinite(record.person_count) && Array.isArray(record.persons)) {
		return record as Partial<PPEAssessment>;
	}

	for (const key of ['response', 'assessment', 'result']) {
		const nested = findAssessment(record[key]);
		if (nested) return nested;
	}

	return null;
}

/**
 * Heuristic: does this error look like Llama's one-time license-agreement
 * prompt? Matched on substrings because the exact message can vary.
 */
function isLicenseAgreementError(error: unknown) {
	const message = String(error instanceof Error ? error.message : error).toLowerCase();
	return message.includes('agree') || message.includes('license') || message.includes('acceptable use');
}
