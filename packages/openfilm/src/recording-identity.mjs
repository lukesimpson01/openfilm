import {SOUND_RECORDINGS} from './sound-recordings.mjs';
export const exactSoundName = (value) => String(value).normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
/** `substitute` pins are user-approved, type-matched CC0 recordings: they keep their real source title and may differ from the label.
 *  Missing or changed sound identities fail closed. Songs retain their separate artist/source audit. */
export function recordingIssue(id, saved, name) {
  const source=SOUND_RECORDINGS[id],sourceTitle=source?.title??source?.name,label=name??source?.name??id;
  if(!source) return id.startsWith('mx-')&&saved?.file ? null : `${label}: exact recording is not verified.`;
  if(source.status!=='verified') return `${label}: no exact named source is verified.`;
  if(!saved?.file||saved.identity?.status!=='verified')return `${label}: the verified recording is unavailable.`;
  if(saved.sourceUrl!==source.pageUrl||saved.mediaUrl!==source.mediaUrl||saved.sha256!==source.sha256||
    exactSoundName(saved.identity.sourceTitle)!==exactSoundName(sourceTitle)||
    exactSoundName(saved.sourceTitle)!==exactSoundName(sourceTitle)||
    !source.substitute&&exactSoundName(sourceTitle)!==exactSoundName(source.name)||
    exactSoundName(saved.title)!==exactSoundName(source.name)||name&&exactSoundName(name)!==exactSoundName(source.name))
    return `${label}: source identity changed; verification is required.`;
  return null;
}
export const soundRecordingSource = (id) => SOUND_RECORDINGS[id];
