# 이지스 (AEGIS) v0.2

말로 묻고 말로 답하는 개인 AI 비서. 브라우저 주소만 열면 쓰고, 수정해서 배포하면 모든 사용자에게 바로 반영된다. (다운로드 없음)

```
브라우저(홀로그램 화면, 마이크/스피커)
      │  HTTPS + 로그인 토큰
      ▼
Firebase Hosting ──/api/**──▶ Cloud Function (서울)
                                  ├─ 로그인 확인 → 마스터 여부 확인
                                  ├─ Claude 호출 (기본: Sonnet 5.5 / 마스터: Opus 5.5)
                                  ├─ 도구 실행 (날씨, 할 일, 기억 검색/저장/삭제)
                                  └─ Firestore에 사용자별 암호화 저장
```

AI 키와 암호화 키는 서버의 비밀 저장소에만 있다. 브라우저는 Firestore에 직접 접근할 수 없다. (firestore.rules가 전부 차단)

## 1. 처음 한 번만 하는 준비

1. **Firebase 프로젝트 만들기**: https://console.firebase.google.com
   요금제를 **Blaze(종량제)** 로 올려야 한다. Functions가 외부 AI API를 부르려면 필요하다. (Firebase 자체 사용량은 무료 한도가 넉넉하고, AI API 요금은 Anthropic에서 따로 청구된다)
2. **Authentication → 시작하기 → Google 로그인 사용 설정**
3. **Firestore Database 만들기**: 위치는 `asia-northeast3 (서울)`, 프로덕션 모드
4. **웹 앱 추가**: 프로젝트 설정 → 내 앱 → 웹(`</>`) → 나오는 `firebaseConfig` 값을 `public/index.html` 위쪽의 `firebaseConfig`에 붙여넣기
5. `.firebaserc`의 `YOUR_PROJECT_ID`를 내 프로젝트 ID로 바꾸기
6. **PC 터미널**에서 (Node.js 20 이상 필요):

```bash
npm i -g firebase-tools
firebase login
cd functions && npm install && cd ..

# Anthropic Console에서 발급한 API 키를 붙여넣는다
firebase functions:secrets:set ANTHROPIC_API_KEY

# 암호화 마스터 키: 아래로 만든 값을 복사해서 붙여넣는다
openssl rand -base64 32
firebase functions:secrets:set ENC_MASTER_KEY
```

   그리고 `functions/.env.example`을 `functions/.env`로 복사해서 **허용할 내 이메일**을 적는다. (`AEGIS_ALLOWED_EMAILS`, 비우면 로그인한 누구나 이지스를 쓰고 AI 비용이 나간다)
   마스터 모드를 쓸 계정은 배포할 때 묻는 `MASTER_ALLOWLIST`에 이메일로 적는다. **비워 두면 아무도 마스터가 될 수 없다.** ("아이 엠 아이언맨"은 유명한 대사라 누구나 말할 수 있기 때문에, 문장만으로 열어 주지 않는다.)

   ⚠️ `ENC_MASTER_KEY`는 **안전한 곳에 백업**해 둘 것. 잃어버리면 저장된 대화를 아무도 읽을 수 없다.

7. **30일 자동 만료 켜기** (한 번만):

```bash
gcloud config set project 내프로젝트ID
gcloud firestore fields ttls update expireAt --collection-group=messages --enable-ttl
gcloud firestore fields ttls update expireAt --collection-group=memories --enable-ttl
gcloud firestore fields ttls update expireAt --collection-group=usage --enable-ttl
```

   만료된 기록의 실제 삭제는 보통 하루 안에 이뤄지고, 앱은 만료된 기록을 즉시 숨긴다.

8. **배포**: `firebase deploy`

배포가 끝나면 나오는 Hosting 주소(`https://프로젝트ID.web.app`)를 폰에서 열면 된다. 크롬에서는 "홈 화면에 추가"로 앱처럼 쓸 수 있다.

## 2. 수정하고 반영하기

| 바꾸려는 것 | 파일 | 배포 명령 |
|---|---|---|
| 화면, 홀로그램, 음성 입출력 | `public/index.html` | `firebase deploy --only hosting` |
| 이지스 성격, 말투, 규칙 | `functions/lib/persona.js` | `firebase deploy --only functions` |
| 모델, 하루 한도, 보관 기간 | `functions/lib/config.js` | `firebase deploy --only functions` |
| 도구 추가/수정 | `functions/lib/tools.js` | `firebase deploy --only functions` |
| 마스터 해금 문장 | `functions/lib/unlock.js` | `firebase deploy --only functions` |

사용자는 앱을 다시 열거나 새로고침만 하면 최신 버전이다. 설치나 업데이트가 필요 없다.

## 3. 동작 요약

- **말하기**: 화면을 탭하고 말한다. 말이 끝나면 이지스가 생각하고 소리로 답한다. 이지스가 말하는 중에 탭하면 바로 끊고 다시 듣는다.
- **마스터 모드**: 로그인한 상태에서 "아이 엠 아이언맨"이라고 말하면 그 계정이 마스터가 된다. 상위 모델(Opus 5.5), 더 큰 하루 한도, 영구 기억이 켜지고 화면에 금빛 링이 생긴다. "마스터 모드 꺼"로 해제한다.
  - 문장 판별은 서버가 한다. 이 문장은 인증이 아니라 기능 스위치이고, 보안은 로그인이 맡는다.
- **저장**: 모든 대화는 텍스트로 사용자별 키로 암호화해 저장된다. (음성 녹음은 저장하지 않는다) 중요한 내용은 이지스가 `save_memory`로 원문 그대로 따로 저장한다.
  - 기본 등급은 30일 보관이고, 검색에 걸려 다시 언급되면 그때부터 다시 30일이다. 마스터는 영구 보관이다.
  - 주민등록번호, 카드번호, "비밀번호는 ~"는 저장 전에 지워진다.
  - "그건 잊어 줘"는 해당 기억만, "전부 삭제 확인"이라고 말하면 대화와 기억 전체를 지운다.
- **도구**: 날씨, 계산기, 시각(세계 시간), 타이머(앱이 열려 있는 동안), 할 일, 설정(사는 도시 등), 루틴/프로토콜, 기억 검색/저장/삭제, 상태 점검, 전부 삭제, 모든 기기 로그아웃. 마스터는 웹 검색이 추가된다.

## 4. 테스트

```bash
cd functions && npm test
```

가짜 AI와 가짜 DB로 암호화(바꿔치기 방지, 키 교체, 키 파기), 민감정보 삭제, 마스터 해금과 허용 목록, 도구 실행, 삭제 확인, 속도 제한, 프롬프트 인젝션 방어 등 50여 개를 검증한다. (Firebase나 API 키 없이 실행됨)

## 5. 알려진 한계 (v0.1)

- **목소리**는 아직 브라우저 내장 음성이라 사람처럼 자연스럽지 않다. `public/index.html`의 `speak()`만 교체하면 되게 분리해 두었다. 다음 단계에서 샘플을 비교해 고른다.
- 답변을 **다 만든 뒤에** 말하기 시작한다. 문장 단위 스트리밍은 다음 단계.
- 화면의 파형은 **연출용**이다. 실제 마이크/목소리 크기와는 연결되지 않았다.
- 음성 인식은 브라우저 기능(Chrome, Safari)을 쓴다. 이 경우 음성이 브라우저 제공 회사의 인식 서버로 전송될 수 있으니 동의 화면에 고지해야 한다. 아이폰 홈 화면 앱 모드에서는 음성 인식이 제한될 수 있으니 Safari에서 먼저 확인할 것.
- "이지스"라고 부르면 깨어나는 **호출어는 없다**. 탭해서 말한다.
- 기억 검색은 키워드 방식이다. 의미 검색(벡터 검색)은 나중에 `functions/lib/memory.js`만 교체한다.
- 마스터 등급은 지금은 **상위 모델, 한도, 영구 보관**이 차이점이다. 캘린더, 이메일 같은 추가 도구는 아직 없다.
- 상위 모델은 비용이 크다. 마스터에도 하루 한도(`config.js`)가 걸려 있으니 사용량을 보며 조정할 것.
- 공개 서비스 전에는 **개인정보 처리방침과 동의 화면**이 필요하다. (개인정보보호법)
- 이 프로젝트는 실제 Firebase와 실제 Anthropic 키로는 아직 실행해 보지 못했다. 로직은 테스트로, 화면은 가짜 로그인/마이크로 확인했다. 첫 배포 때 문제가 나오면 `firebase functions:log`를 확인할 것.

## 6. 보안 구조 (v0.2)

**겹겹의 방어** (한 겹이 뚫려도 다음 겹이 막도록 설계):

| 층 | 내용 |
|---|---|
| 접속 | HTTPS 강제(HSTS), CSP, 프레임 삽입 금지, 출처(Origin) 검사, 로그인 전 IP 속도 제한 |
| 신원 | Google 로그인 + 이메일 인증 + 폐기 여부 확인된 토큰, 허용 이메일 목록, (선택) App Check |
| 호출 | 본문 크기·형식 검사, 인스턴스 속도 제한, 분당/일일/서비스 전체 한도(DB 카운터) |
| 입력 | 보이지 않는 글자 제거, 주민번호·카드번호·"비밀번호는…" 삭제 후에야 저장/AI 전달 |
| AI | 도구 목록 안에서만 행동, 도구 결과는 `<untrusted_data>`로 표시(기억·웹에 숨은 명령 무시), 위험한 작업은 서버가 "사용자가 직접 한 확인 문장 + 최근 로그인"을 검사 |
| 저장 | Firestore는 클라이언트 접근 전면 차단. 모든 텍스트는 AES-256-GCM, **사용자마다 다른 무작위 키**, 암호문에 "누구의 어느 필드인지"를 묶어 바꿔치기 불가 |
| 키 | 사용자 키는 Secret Manager 마스터 키 또는 **Cloud KMS**로 감싸 저장. 마스터 키는 `새키,옛키`로 교체 가능 |
| 삭제 | "전부 삭제 확인" 시 데이터와 감긴 키를 함께 파기(백업에 암호문이 남아도 영원히 못 읽음) |
| 기록 | 보안 사건(해시한 사용자, 사건 종류)만 로그. **대화 내용은 어떤 로그에도 남기지 않음** |

**Cloud KMS 켜기 (권장, 키가 서버 밖에 있고 사용 기록이 남는다)**

```bash
gcloud services enable cloudkms.googleapis.com
gcloud kms keyrings create aegis --location=asia-northeast3
gcloud kms keys create user-keys --keyring=aegis --location=asia-northeast3 --purpose=encryption
# Functions 실행 계정에만 암호화/복호화 권한을 준다
gcloud kms keys add-iam-policy-binding user-keys --keyring=aegis --location=asia-northeast3 \
  --member=serviceAccount:실행계정@프로젝트.iam.gserviceaccount.com --role=roles/cloudkms.cryptoKeyEncrypterDecrypter
```
배포할 때 `KMS_KEY_NAME`에 `projects/프로젝트/locations/asia-northeast3/keyRings/aegis/cryptoKeys/user-keys`를 넣는다.

**App Check (선택)**: Firebase 콘솔 → App Check → reCAPTCHA Enterprise 등록 → 사이트 키를 `public/index.html`의 `APP_CHECK_SITE_KEY`에 넣고, 잘 되는지 본 뒤 `functions/.env`에서 `AEGIS_ENFORCE_APPCHECK=true`.

### 정직한 한계 (절대 안전은 없다)
- **AI가 읽는 순간에는 평문이다.** 이지스가 대답하려면 대화 내용이 Anthropic API로 전송된다. Anthropic은 API 데이터를 기본적으로 학습에 쓰지 않지만 표준 30일 보관 정책이 있다(제로 보관은 별도 계약). 그래서 "전부 삭제"로도 Anthropic 쪽 보관분은 지워지지 않는다. **동의 화면에 반드시 고지**하고, 최신 약관을 확인할 것.
- **서버 코드를 배포하는 사람(= 주인님)은 이론상 복호화 코드를 바꿀 수 있다.** 그래서 운영자가 개발자를 믿을 필요가 없게 권한을 나눈다 (아래).
- 브라우저 음성 인식은 브라우저 회사의 서버를 거칠 수 있다.
- CSP, KMS, App Check, 실제 Anthropic 호출은 이 개발 환경에서 **실제로 실행해 보지 못했다.** 첫 배포 후 로그인이 막히면 `firebase.json`의 `Content-Security-Policy` 헤더 이름을 `Content-Security-Policy-Report-Only`로 바꿔 원인을 찾을 것.

### "개발 도우미(Claude)가 대화 내용을 못 보게" 하는 법
- Claude와의 개발 대화에는 **프로덕션 키, 서비스 계정 파일, DB 접근 권한, 사용자 대화 내용을 절대 붙여넣지 않는다.** 이 개발 환경은 주인님의 Firebase에 접근할 수 없고, 접근 수단을 주지 않는 한 볼 수도 없다.
- 오류가 나면 `firebase functions:log`에서 **내용이 없는 오류 문구만** 복사해 주면 된다. 서버는 내용을 로그에 남기지 않도록 만들어져 있다.
- 개발용과 운영용 Firebase 프로젝트를 **분리**하고, 개발 중에는 테스트 계정만 쓴다.
- KMS를 쓰면 키 사용 권한을 실행 계정에만 주고, 개인 계정에는 `cloudkms.cryptoKeyEncrypterDecrypter`와 Firestore 읽기 권한을 주지 않는 식으로 나눌 수 있다. 그러면 개발자 계정으로는 보안·오류 코드는 고쳐도 데이터는 못 읽는다.

## 7. 기능 로드맵과 "이거 필요할까?" 판단

공격면(뚫릴 수 있는 곳)이 기능과 함께 늘어나므로, 위험이 큰 것은 확인 절차를 붙여 뒤로 미룬다.

| 기능 | 판단 |
|---|---|
| 아침 브리핑, 루틴, 타이머, 계산기, 세계 시간 | 구현됨 (낮은 위험) |
| 웹 검색 (마스터) | 구현됨. 결과 속 명령은 무시하도록 처리, 호출 횟수 제한 |
| 캘린더 읽기/쓰기 | 필요함. 다음 단계 (OAuth 최소 권한, 일정 추가 전 확인) |
| 푸시 알림 | 필요함. 지금 타이머는 앱이 열려 있을 때만 울리므로 다음 단계 (FCM) |
| 목소리 교체(자연스러운 TTS), 문장 단위 스트리밍 | 필요함. 라이선스 확인된 음성 서비스로 비교 후 선택 |
| 내 데이터 내려받기(개인정보 열람권) | 공개 서비스 전에 필요 |
| 이메일 읽기/보내기 | 위험 큼. 보내기는 항상 읽어주고 확인, 마스터 한정으로 신중히 |
| 결제/송금, 스마트홈 잠금장치 | **지금은 넣지 않는 것을 권한다.** 잘못 실행되면 되돌릴 수 없다 |
| 의미 검색(벡터), 호출어 | 있으면 좋음. 비용·복잡도 대비 나중에 |
