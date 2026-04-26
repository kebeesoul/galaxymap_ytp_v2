import { Composition, registerRoot } from 'remotion'

// Load Google Fonts for Remotion renderer (Chromium headless loads fonts from CDN)
if (typeof document !== 'undefined') {
  const link = Object.assign(document.createElement('link'), {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@700&family=Black+Han+Sans&family=Nanum+Gothic:wght@700&family=Gothic+A1:wght@700&family=Noto+Serif+KR:wght@700&family=Gowun+Dodum&display=swap',
  })
  document.head.appendChild(link)
}
import LayoutA from './compositions/LayoutA'
import LayoutB from './compositions/LayoutB'
import LayoutC from './compositions/LayoutC'

const DEFAULT_FPS = 30
const DEFAULT_WIDTH = 1080
const DEFAULT_HEIGHT = 1920 // 9:16 portrait shortform

const defaultClip = { start_sec: 0, end_sec: 60 }

function calcDuration(startSec: number, endSec: number) {
  return Math.max(1, Math.round((endSec - startSec) * DEFAULT_FPS))
}

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="LayoutA"
        component={LayoutA}
        fps={DEFAULT_FPS}
        width={DEFAULT_WIDTH}
        height={DEFAULT_HEIGHT}
        defaultProps={{
          clip: defaultClip,
          segments: [],
          comments: [],
          preview_path: '',
        }}
        calculateMetadata={({ props }) => ({
          durationInFrames: calcDuration(props.clip.start_sec, props.clip.end_sec),
        })}
      />

      <Composition
        id="LayoutB"
        component={LayoutB}
        fps={DEFAULT_FPS}
        width={DEFAULT_WIDTH}
        height={DEFAULT_HEIGHT}
        defaultProps={{
          clip: defaultClip,
          segments: [],
          preview_path: '',
        }}
        calculateMetadata={({ props }) => ({
          durationInFrames: calcDuration(props.clip.start_sec, props.clip.end_sec),
        })}
      />

      <Composition
        id="LayoutC"
        component={LayoutC}
        fps={DEFAULT_FPS}
        width={DEFAULT_WIDTH}
        height={DEFAULT_HEIGHT}
        defaultProps={{
          clip: defaultClip,
          comments: [],
          preview_path: '',
        }}
        calculateMetadata={({ props }) => ({
          durationInFrames: calcDuration(props.clip.start_sec, props.clip.end_sec),
        })}
      />
    </>
  )
}

registerRoot(RemotionRoot)
