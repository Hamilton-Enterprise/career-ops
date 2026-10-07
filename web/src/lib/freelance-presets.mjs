import { cleanChips } from "./clean-chips.mjs";

export const FREELANCE_SHORTCUTS = {
  Websites: ["website", "web design", "landing page"],
  Aplicações: ["application", "app development", "mobile app"],
  Chatbots: ["chatbot", "conversational AI"],
  Automação: ["automation", "workflow automation"],
  IA: ["AI", "artificial intelligence", "generative AI"],
};

/** Add a shortcut's terms to the existing editable title chips. */
export function applyFreelanceShortcut(existing, label) {
  return cleanChips([...(Array.isArray(existing) ? existing : []), ...(FREELANCE_SHORTCUTS[label] ?? [])]);
}
