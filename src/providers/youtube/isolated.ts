import { YouTubeAdapter } from '../../media-features/youtube-adapter';
import { providerRuntime } from '../provider-api';

import { youtubeLauncherPlacement } from './launcher-placement';
import { youtubeWatchPlayback } from './watch-playback';

providerRuntime('isolated')?.register({
  id: 'youtube', contractVersion: 1,
  watchPlayback: youtubeWatchPlayback,
  createAdapter: video => new YouTubeAdapter(video),
  launcherPlacement: youtubeLauncherPlacement
});
