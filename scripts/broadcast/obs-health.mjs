// Read only. Deliberately exclude URLs, tokens and raw service configuration.
import fs from 'node:fs';
import path from 'node:path';
const config=path.join(process.env.APPDATA,'obs-studio');
const directory=path.join(config,'logs');
const files=fs.readdirSync(directory).filter(n=>/^\d{4}-\d\d-\d\d.*\.txt$/.test(n)).sort().reverse();
const log=files[0];if(!log)throw Error('No OBS log');
const lines=fs.readFileSync(path.join(directory,log),'utf8').split(/\r?\n/);
const candidates=lines.filter(line=>/whip|webrtc|streaming|nvenc|encoder|video settings|resolution|color format|color space|fps:|browser|audio settings|rate_control|keyint|b-frames|bf:|profile:|bitrate:|preset:|error|failed/i.test(line));
const safe=candidates.filter(line=>!/(?:https?:|wss?:|rtmps?:|bearer|token|password|authorization|[?&]\w+=)/i.test(line)&&line.length<350).slice(-70);
console.log(JSON.stringify({log,lines:safe}));
