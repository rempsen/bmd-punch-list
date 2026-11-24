/**
 * The picture used to prove the AI connection accepts images: a 32×32 solid blue square (95 bytes, no library
 * needed). A model that can see it answers "blue"; one that cannot is refused by the gateway or guesses, and either
 * way the check reports it.
 */
import type { Ask, AskImage } from "./gateway";

export const BLUE_SQUARE: AskImage = { mediaType: "image/png", base64: "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAJklEQVR42u3NsQkAAAjAsP7/tF7hIASyp5pjAoFAIBAIBAKB4EmwOkv8Lom8x/sAAAAASUVORK5CYII=" };

export const IMAGE_CHECK: Ask = { system: "You will be shown one small picture. Reply with one word: its colour.", prompt: "What colour is this picture?", images: [BLUE_SQUARE], maxTokens: 32 };

/** Whether a reply to IMAGE_CHECK shows the model saw the picture. */
export const sawThePicture = (reply: string) => /\bblue\b/i.test(reply);
