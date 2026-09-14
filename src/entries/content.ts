import '../content.css';
import theaterCss from '../content.css?inline';
import { setPlayerUiCss } from '../ui/root';
import { bootstrapPlayerRuntime } from '../ui/player-runtime';

setPlayerUiCss(theaterCss);
bootstrapPlayerRuntime();
