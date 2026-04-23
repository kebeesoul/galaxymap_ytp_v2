import { Composition } from 'remotion'
import LayoutA, { type LayoutAProps } from './compositions/LayoutA'
import LayoutB, { type LayoutBProps } from './compositions/LayoutB'
import LayoutC, { type LayoutCProps } from './compositions/LayoutC'

const DEFAULT_FPS = 30
const DEFAULT_WIDTH = 1080
const DEFAULT_HEIGHT = 1920 // 9:16 portrait shortform

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="LayoutA"
        component={LayoutA}
        durationInFrames={DEFAULT_FPS * 60}
        fps={DEFAULT_FPS}
        width={DEFAULT_WIDTH}
        height={DEFAULT_HEIGHT}
        defaultProps={
          {
            previewPath: '',
            segments: [],
            comments: [],
          } satisfies LayoutAProps
        }
      />
      <Composition
        id="LayoutB"
        component={LayoutB}
        durationInFrames={DEFAULT_FPS * 60}
        fps={DEFAULT_FPS}
        width={DEFAULT_WIDTH}
        height={DEFAULT_HEIGHT}
        defaultProps={
          {
            previewPath: '',
            segments: [],
          } satisfies LayoutBProps
        }
      />
      <Composition
        id="LayoutC"
        component={LayoutC}
        durationInFrames={DEFAULT_FPS * 60}
        fps={DEFAULT_FPS}
        width={DEFAULT_WIDTH}
        height={DEFAULT_HEIGHT}
        defaultProps={
          {
            previewPath: '',
            comments: [],
          } satisfies LayoutCProps
        }
      />
    </>
  )
}
