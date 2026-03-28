// Korean Hangul to Revised Romanization
// Covers the standard Korean consonant/vowel system

const INITIALS = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const MEDIALS = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const FINALS = ['', 'g', 'kk', 'gs', 'n', 'nj', 'nh', 'd', 'l', 'lg', 'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'b', 'bs', 's', 'ss', 'ng', 'j', 'ch', 'k', 't', 'p', 'h'];

export function romanizeKorean(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Hangul syllable range: 0xAC00 - 0xD7A3
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const syllable = code - 0xAC00;
      const initial = Math.floor(syllable / (21 * 28));
      const medial = Math.floor((syllable % (21 * 28)) / 28);
      const final = syllable % 28;
      result += INITIALS[initial] + MEDIALS[medial] + FINALS[final];
    } else {
      result += text[i];
    }
  }
  return result;
}

// Common KBO player name romanizations (Korean → common English spellings)
// This supplements the algorithmic romanization for well-known players
const KNOWN_NAMES: Record<string, string> = {
  '김도영': 'Kim Do-yeong',
  '이정후': 'Lee Jung-hoo',
  '김현수': 'Kim Hyun-soo',
  '박병호': 'Park Byung-ho',
  '강백호': 'Kang Baek-ho',
  '이대호': 'Lee Dae-ho',
  '추신수': 'Choo Shin-soo',
  '오승환': 'Oh Seung-hwan',
  '류현진': 'Ryu Hyun-jin',
  '김하성': 'Kim Ha-seong',
  '나성범': 'Na Sung-bum',
  '안치홍': 'Ahn Chi-hong',
  '허경민': 'Heo Kyung-min',
  '김선빈': 'Kim Sun-bin',
  '홍창기': 'Hong Chang-ki',
  '문보경': 'Moon Bo-kyung',
  '채은성': 'Chae Eun-seong',
  '박건우': 'Park Kun-woo',
  '전민재': 'Jeon Min-jae',
  '노진혁': 'Noh Jin-hyuk',
  '윤동희': 'Yoon Dong-hee',
  '하주석': 'Ha Joo-suk',
  '권희동': 'Kwon Hee-dong',
  '심우준': 'Shim Woo-jun',
  '오재원': 'Oh Jae-won',
  '박동원': 'Park Dong-won',
  '김건희': 'Kim Geon-hee',
  '이정훈': 'Lee Jung-hoon',
  '문현빈': 'Moon Hyun-bin',
  '이강민': 'Lee Kang-min',
  '안현민': 'Ahn Hyun-min',
  '김성윤': 'Kim Sung-yoon',
  '류현인': 'Ryu Hyun-in',
};

export function getEnglishName(koreanName: string): string {
  // Check known names first
  if (KNOWN_NAMES[koreanName]) return KNOWN_NAMES[koreanName];

  // Fall back to algorithmic romanization
  const romanized = romanizeKorean(koreanName);

  // Basic formatting: capitalize first letter of each syllable group
  // Korean names are typically 3 chars: family + given1 + given2
  const chars = koreanName.split('');
  if (chars.length === 3) {
    const family = romanizeKorean(chars[0]);
    const given1 = romanizeKorean(chars[1]);
    const given2 = romanizeKorean(chars[2]);
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    return `${cap(family)} ${cap(given1)}-${given2}`;
  }

  return romanized;
}
