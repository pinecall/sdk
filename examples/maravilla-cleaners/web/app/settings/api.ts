import type { Route } from "./+types/api";
import { Settings } from "./model.server";

// GET /api/settings · PUT /api/settings
export const loader = () => Response.json(Settings.get());
export const action = async ({ request }: Route.ActionArgs) => Response.json(Settings.update(await request.json()));
