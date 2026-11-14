import { get } from "../shared/http/client.js";
import { register } from "../shared/register.js";

export const load = register(get);
