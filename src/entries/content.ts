import '../content.css';
import playerUiCss from '../ui/shadow.css?inline';
import { setPlayerUiCss } from '../ui/root';
import { bootstrapPlayerRuntime } from '../ui/player-runtime';

setPlayerUiCss(playerUiCss);
bootstrapPlayerRuntime();
