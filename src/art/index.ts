import { art as actions } from "./actions";
import { art as animals } from "./animals";
import { art as avatars } from "./avatars";
import { art as food } from "./food";
import { art as places } from "./places";
import { art as things } from "./things";
import { art as ui } from "./ui";

// Every drawing in the game, keyed by name: the 90 words, "avatar-<id>", "cat-<Category>", "decor-*" and "icon-*".
export const ART: Record<string, string> = { ...animals, ...food, ...things, ...places, ...actions, ...avatars, ...ui };
