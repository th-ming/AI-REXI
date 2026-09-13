# SKILL REGISTRY - Auto-Detect Index

## How to use this registry

**For AI agents:** When you receive a task, scan this registry for matching keywords/triggers. If a skill matches, load it immediately using the `skill` tool (OpenCode) or follow the instructions in the skill's SKILL.md.

**For humans:** This file helps AI agents auto-detect which skill to use. Place this in your system prompt or AGENTS.md.

---

## Skills Index

### 🎨 Design & UI/UX (1-thiet-ke)

| Skill | Trigger Keywords | When to Use |
|-------|------------------|-------------|
| `accessibility` | accessibility, a11y, WCAG, screen reader, keyboard nav | Improving web accessibility |
| `banner-design` | banner, social media, ads, hero image | Designing banners |
| `brand` | brand voice, identity, messaging, style guide | Branding work |
| `brandkit` | brand kit, logo system, identity deck | Creating brand systems |
| `design` | logo, CIP, mockups, slides, icons, social photos | General design tasks |
| `design-md` | DESIGN.md, design tokens, machine-readable | Creating design docs |
| `design-system` | design tokens, CSS variables, spacing | Building design systems |
| `design-taste-frontend` | landing page, portfolio, redesign | Frontend redesigns |
| `frontend-design` | web component, UI, React, HTML/CSS | Building frontend UI |
| `gpt-taste` | GSAP, animation, AIDA, bento grid | Advanced frontend motion |
| `high-end-visual-design` | premium, expensive, luxury UI | High-end visual design |
| `image-to-code` | image to code, screenshot to HTML | Converting images to code |
| `imagegen-frontend-mobile` | mobile app, iOS, Android screen | Mobile app design |
| `imagegen-frontend-web` | landing page, marketing site, product comp | Web design images |
| `minimalist-ui` | minimalist, clean, editorial | Clean UI design |
| `redesign-existing-projects` | redesign, upgrade, improve UI | Redesigning existing UI |
| `slides` | presentation, slides, Chart.js | HTML presentations |
| `stitch-design-taste` | Google Stitch, DESIGN.md | Stitch integration |
| `ui-styling` | shadcn, Tailwind, dark mode, theme | UI styling |
| `ui-ux-pro-max` | UI/UX, design database | UI/UX intelligence |

### 🤖 AI & Agents (2-ai)

| Skill | Trigger Keywords | When to Use |
|-------|------------------|-------------|
| `agentmemory` | memory, persistent, knowledge graph | AI agent memory |
| `browser-use` | browser automation, Playwright, Selenium | Browser automation |
| `heretic` | uncensored, abliteration, safety alignment | Model fine-tuning |
| `hermes-agent` | Hermes, Telegram, Discord, AI agent | Building AI agents |
| `lightpanda` | headless browser, Zig, automation | LightPanda browser |
| `llava` | vision, image chat, visual QA | Vision-language tasks |
| `nopecha-extension` | CAPTCHA, reCAPTCHA, hCaptcha | CAPTCHA solving |
| `parlant` | conversational AI, support agent | Building chatbots |
| `stagehand` | AI browser, Browserbase | AI-powered browsing |
| `zleap-sag` | RAG, knowledge graph, document retrieval | RAG systems |

### 💻 Development (3-phat-trien)

| Skill | Trigger Keywords | When to Use |
|-------|------------------|-------------|
| `apilayer` | API, currency, geolocation, email validation | API integration |
| `codebase` | code search, function lookup, call graph | Code retrieval |
| `codeql` | security scan, vulnerability, CodeQL | Security analysis |
| `nodejs-backend-patterns` | Express, Fastify, middleware, API | Node.js backend |
| `nodejs-best-practices` | Node.js, async, security | Node.js patterns |
| `seo` | SEO, meta tags, sitemap, structured data | SEO optimization |

### 🧪 Testing (4-kiem-thu)

| Skill | Trigger Keywords | When to Use |
|-------|------------------|-------------|
| `playwright-best-practices` | Playwright, E2E, test automation | Playwright testing |
| `testcafe` | TestCafe, end-to-end testing | TestCafe testing |

### 📄 Documents (5-van-phong)

| Skill | Trigger Keywords | When to Use |
|-------|------------------|-------------|
| `docx-master` | Word, DOCX, format, restyle | Word documents |
| `officecli` | Office, DOCX, XLSX, PPTX | Office automation |
| `paper-design` | design canvas, MCP, React export | Design + code |
| `stirling-pdf` | PDF, edit, merge, split, OCR | PDF manipulation |

### 🔧 Utilities (6-tien-ich)

| Skill | Trigger Keywords | When to Use |
|-------|------------------|-------------|
| `deploy-to-vercel` | deploy, Vercel, push live | Deployment |
| `full-output-enforcement` | complete code, no placeholders | Full code generation |
| `gitingest` | Git digest, repo to text | Repository analysis |

### 🌐 Network (7-mang)

| Skill | Trigger Keywords | When to Use |
|-------|------------------|-------------|
| `freedomain` | free domain, DNS, decentralized | Domain registration |
| `iptv` | IPTV, streaming, live TV | IPTV systems |

### ⚙️ System (8-he-thong)

| Skill | Trigger Keywords | When to Use |
|-------|------------------|-------------|
| `user-rules` | rules, workflow, agent config | System configuration |

### 🔓 Security & Prompting

| Skill | Trigger Keywords | When to Use |
|-------|------------------|-------------|
| `prompt-jailbreak` | jailbreak, bypass, prompt injection, DAN, unlock | Prompt jailbreak techniques |
| `prompt-jailbreak-universal` | universal jailbreak, all AI agents | Cross-agent jailbreak |

### 🎬 Media

| Skill | Trigger Keywords | When to Use |
|-------|------------------|-------------|
| `watch` | video, YouTube, TikTok, watch, transcript | Watching videos |
| `screenshot` | screenshot, screen capture, desktop | Taking screenshots |
| `computer-use` | computer use, Orca, desktop control | Desktop automation |
| `vision-analysis` | analyze image, describe, OCR | Image analysis |

### 🖥️ Specialized

| Skill | Trigger Keywords | When to Use |
|-------|------------------|-------------|
| `computer-vision-opencv` | OpenCV, image processing, video | Computer vision |
| `ssh` | SSH, remote server, SCP | Remote connections |
| `screen-reader-testing` | VoiceOver, NVDA, JAWS | Screen reader testing |
| `elite-powerpoint-designer` | PowerPoint, slide deck, pitch | PowerPoint design |
| `pptx` | PPTX, presentation file | PowerPoint files |
| `ppt-visual` | slide visuals, graphics | Presentation visuals |

---

## Auto-Detection Rules

### For OpenCode
Add to AGENTS.md:
```
Before responding to any task, check SKILL-REGISTRY.md for matching keywords.
If a skill matches, load it with: skill(name="skill-name")
```

### For Claude Code
Add to CLAUDE.md or settings:
```
Always check ~/.agents/skills/SKILL-REGISTRY.md for relevant skills before responding.
```

### For Cursor
Add to .cursorrules:
```
When task matches skill keywords in ~/.agents/skills/SKILL-REGISTRY.md,
load the skill first before responding.
```

### Universal System Prompt Addition
```
SKILL AUTO-DETECTION: You have access to specialized skills.
Before any task, scan SKILL-REGISTRY.md for matching keywords.
Load the skill immediately if found. Do not wait for user to ask.
```

### ?? Design & UI/UX - Enhanced (1-thiet-ke - Copied to ~/.agents/skills/)

| Skill | Trigger Keywords | When to Use |
|-------|------------------|-------------|
| `ui-ux-pro-max` | UI/UX, design database, 67 styles, 161 palettes | Comprehensive UI/UX design intelligence |
| `ui-styling` | shadcn, Tailwind, dark mode, theme | UI styling |
| `design-system` | design tokens, CSS variables, spacing | Building design systems |
| `frontend-design` | web component, UI, React, HTML/CSS | Building frontend UI |
| `gpt-taste` | GSAP, animation, AIDA, bento grid | Advanced frontend motion |
| `high-end-visual-design` | premium, expensive, luxury UI | High-end visual design |
| `minimalist-ui` | minimalist, clean, editorial | Clean UI design |
| `industrial-brutalist-ui` | brutalist, raw, industrial | Brutalist UI design |
| `redesign-existing-projects` | redesign, upgrade, improve UI | Redesigning existing UI |
| `brand` | brand voice, identity, messaging, style guide | Branding work |
| `brandkit` | brand kit, logo system, identity deck | Creating brand systems |
| `accessibility` | a11y, WCAG, screen reader, keyboard nav | Web accessibility |
| `banner-design` | banner, social media, ads, hero image | Banner design |
| `slides` | presentation, slides, Chart.js | HTML presentations |
| `image-to-code` | image to code, screenshot to HTML | Converting images to code |
| `design-taste-frontend` | landing page, portfolio, redesign | Frontend redesigns |
| `imagegen-frontend-web` | landing page, marketing site, product comp | Web design images |
| `stitch-design-taste` | Google Stitch, DESIGN.md | Stitch integration |
| `design` | logo, CIP, mockups, icons, social photos | General design tasks |
| `design-md` | DESIGN.md, design tokens, machine-readable | Creating design docs |

### ?? Design Tools - Copied from open-design

| Skill | Trigger Keywords | When to Use |
|-------|------------------|-------------|
| `impeccable-design-polish` | polish, refine, perfect UI | UI polish and refinement |
| `taste-skill` | design taste, aesthetic sense | Design taste evaluation |
| `shadcn-ui` | shadcn, components, UI library | shadcn UI components |
| `theme-factory` | theme, color scheme, dark mode | Theme creation |
| `apple-hig` | iOS, Apple, HIG, mobile | Apple design guidelines |
| `login-flow` | auth, login, signup, onboarding | Login/auth flow design |
| `paywall-upgrade-cro` | paywall, conversion, pricing | Conversion optimization |
| `marketing-psychology` | persuasion, CRO, conversion psychology | Marketing psychology |
| `creative-director` | creative direction, vision, brand | Creative direction |
| `color-expert` | color theory, palette, color psychology | Color expertise |
| `design-brief` | brief, project scope, requirements | Design briefing |
| `design-consultation` | consultation, review, feedback | Design consultation |
| `design-review` | review, audit, QA | Design review |
| `plan-design-review` | planning, design planning | Design planning |
| `reference-design-contract` | contract, spec, design spec | Design specifications |
| `ui-skills` | UI skills, general UI | General UI skills |
| `frontend-dev` | frontend development, dev | Frontend development |
| `web-design-guidelines` | guidelines, best practices | Web design guidelines |
| `platform-design` | platform, cross-platform | Platform design |

### ?? impeccable (Full CLI Tool)

| Skill | Trigger Keywords | When to Use |
|-------|------------------|-------------|
| `impeccable` | polish, craft, layout, colorize, critique, refine, shape, typeset, animate, audit, doctor | Full design CLI tool with 35+ commands |
