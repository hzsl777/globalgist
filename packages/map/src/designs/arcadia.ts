// Course of Empire (arcadia): loaded the first time the design is shown (src/registry.ts). It brings the design's CSS and fonts
// and registers what the map and the page call into for it.
import "./arcadia.css";
import "../fonts/imperial-column.css";
import { registerKit } from "../registry.ts";
import * as scenery from "../map/scenery.ts";

registerKit("scenery", scenery);
