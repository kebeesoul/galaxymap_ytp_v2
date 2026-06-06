import { loadFont as loadLocalFont } from '@remotion/fonts'
import { loadFont as loadBebasNeue } from '@remotion/google-fonts/BebasNeue'
import { loadFont as loadBlackHanSans } from '@remotion/google-fonts/BlackHanSans'
import { loadFont as loadGowunDodum } from '@remotion/google-fonts/GowunDodum'
import { loadFont as loadInter } from '@remotion/google-fonts/Inter'
import { loadFont as loadJua } from '@remotion/google-fonts/Jua'
import { loadFont as loadMontserrat } from '@remotion/google-fonts/Montserrat'
import { loadFont as loadNotoSansKR } from '@remotion/google-fonts/NotoSansKR'
import { loadFont as loadOswald } from '@remotion/google-fonts/Oswald'
import { loadFont as loadPlayfairDisplay } from '@remotion/google-fonts/PlayfairDisplay'
import { loadFont as loadRoboto } from '@remotion/google-fonts/Roboto'
import { staticFile } from 'remotion'

loadMontserrat('normal', { weights: ['700'], subsets: ['latin'] })
loadInter('normal', { weights: ['700'], subsets: ['latin'] })
loadBebasNeue('normal', { weights: ['400'], subsets: ['latin'] })
loadPlayfairDisplay('normal', { weights: ['700'], subsets: ['latin'] })
loadOswald('normal', { weights: ['700'], subsets: ['latin'] })
loadRoboto('normal', { weights: ['700'], subsets: ['latin'] })
loadNotoSansKR('normal', {
  weights: ['700'],
  subsets: ['korean', 'latin'],
  ignoreTooManyRequestsWarning: true,
})
loadGowunDodum('normal', {
  weights: ['400'],
  subsets: ['korean', 'latin'],
  ignoreTooManyRequestsWarning: true,
})
loadBlackHanSans('normal', {
  weights: ['400'],
  subsets: ['korean', 'latin'],
  ignoreTooManyRequestsWarning: true,
})
loadJua('normal', {
  weights: ['400'],
  subsets: ['korean', 'latin'],
  ignoreTooManyRequestsWarning: true,
})

void loadLocalFont({
  family: 'Gmarket Sans',
  url: staticFile('fonts/gmarket/GmarketSansTTFBold.ttf'),
  weight: '700',
  format: 'truetype',
})
void loadLocalFont({
  family: 'NanumSquare',
  url: staticFile('fonts/nanum-square/NanumSquareB.woff2'),
  weight: '700',
  format: 'woff2',
})
