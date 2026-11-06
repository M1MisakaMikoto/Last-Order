# Last Order

命名优先级：`Last Order` > `last-order` > `last-order`。前者用于所有人类可见文本；受限机器标识使用后者，已发布扩展 ID 保持兼容。

Last Order 鏄?Windows 涓婄殑 coding-agent 宸ヤ綔鍖猴紝涓€涓?manager 瀵规帴鐢ㄦ埛锛孧ission Control 涓ぎ鏈嶅姟绠＄悊鐙珛 worker 浠诲姟銆乵anager 鑷敤澶囨敞鍜屽畬鎴愬洖璋冦€俶anager 鍜岄粯璁?worker 鍙垎鍒€夋嫨 Claude Code銆丆odex銆丏eepSeek Harness 鎴?OpenCode銆?
褰撳墠鐗堟湰鎻愪緵鍙繍琛岀殑璋冨害绯荤粺涓?TUI銆佸洓绫诲師鐢熷崗璁€傞厤鍣ㄥ拰鑷姩鍖栨祴璇曘€傚簲鐢ㄥ彧杩炴帴閫夊畾鐨勭湡瀹?CLI锛屾部鐢ㄥ叾鐧诲綍涓庢ā鍨嬮厤缃€侰odex 鐨勭湡瀹?manager 鈫?瀹炵幇 worker 鈫?鐙珛楠屾敹 鈫?浜や粯鍒嗘敮闂幆宸茶窇閫氾紱鍏朵粬涓夌被鐨勭湡瀹炴ā鍨嬮棴鐜殏鏈畬鎴愩€?
## Multi-project workspace

Open a workspace root such as `D:/workspaces`. Last Order checks the root and its direct child directories for Git repositories without scanning deeper, labels them `-A`, `-B`, and so on, shows up to three projects with `Alt+Up/Down` scrolling, and routes `-A message` or `-B message` to the selected project using Tab completion.

The Last Order activity-bar container also includes the vendored MIT Git Diff view. It supports repository/comparison selection, changed and unchanged file trees, native VS Code diffs, context export, and optional Codex MCP integration without a separate Git Diff Viewer extension.

## 鍚姩

闇€瑕?Node.js **24+**銆丟it锛屼互鍙婂噯澶囦娇鐢ㄧ殑 CLI锛涙部鐢ㄥ悇 CLI 宸叉湁鐨勭櫥褰曚笌妯″瀷閰嶇疆銆傛湰椤圭洰娌℃湁绗笁鏂?npm 杩愯渚濊禆銆?
鍦ㄤ氦浜掔粓绔惎鍔紝鎸囧畾椤圭洰鐩綍锛堝凡鏈?Git 浠撳簱鎴栨柊寤虹殑绌虹洰褰曪級锛?
```powershell
npm start -- --project D:\your\project --manager codex --worker codex
```

涔熷彲鐩存帴浣跨敤鍛戒护琛屽叆鍙ｏ細

```powershell
node bin/last-order.js doctor
node bin/last-order.js --project D:\your\project --manager codex --worker codex
```

杞戒綋鍚嶇О涓?`claude`銆乣codex`銆乣dsh`銆乣opencode`銆傞娆℃湭鎸囧畾鏃跺彲浜や簰閫夋嫨锛屼箣鍚庝繚瀛樺湪璇ラ」鐩厤缃腑銆傝繘鍏?TUI 鍚庡彲鐢?`/settings` 淇敼 Manager 鍜岄粯璁?Worker 鐨?provider銆乵odel銆乪ffort锛屼互鍙?Codex 瀹℃壒鏂瑰紡銆佹渶澶у苟鍙戝拰闈欓粯闃堝€硷紱淇濆瓨鍚庡啓鍥為」鐩厤缃紝閲嶅惎 Last Order 鐢熸晥銆俶odel/effort 瀛楁鎸?Enter 杩涘叆鏂囨湰缂栬緫锛孋trl+S 淇濆瓨銆俙--manager`銆乣--worker` 绛夊惎鍔ㄥ弬鏁板彧瑕嗙洊鏈杩愯锛屽苟浼氬湪鍚姩鏃舵洿鏂伴」鐩厤缃€?
Codex worker 榛樿鍚敤 **Approve for me**锛氱敱 Codex 鍘熺敓 `auto_review` 瀹℃壒鍣ㄥ垽鏂渶瑕佹巿鏉冪殑鎿嶄綔锛屾棩甯镐换鍔℃棤闇€閫愰」杈撳叆鎵瑰噯鍛戒护銆傞渶瑕佹墜鍔ㄥ鎵规椂锛屽惎鍔ㄥ弬鏁版坊鍔?`--codex-approvals user`锛涙仮澶嶈嚜鍔ㄥ鎵逛娇鐢?`--codex-approvals auto_review`锛岄€夋嫨淇濆瓨鍦ㄩ」鐩厤缃腑銆俶anager 淇濇寔鍙鏉冮檺銆?
鏂伴」鐩彧闇€鍏堝垱寤轰竴涓┖鐩綍銆侺astOrder 棣栨鍚姩浼氫负璇ョ┖鐩綍鍒濆鍖?Git锛坄main` 鍒嗘敮锛夊苟鍒涘缓涓嶅寘鍚枃浠剁殑鍒濆鎻愪氦锛涙棤闇€棰勫厛閰嶇疆 Git 鎻愪氦韬唤锛屼篃涓嶄慨鏀瑰叏灞€ Git 閰嶇疆銆?
闈?Git 鐩綍浼氳嚜鍔ㄥ垵濮嬪寲 Git 骞跺缓绔嬬┖鍩虹嚎锛涘凡鏈夋枃浠朵笉浼氳 stage 鎴栨彁浜ゅ埌 main锛岃€屾槸閫氳繃涓存椂 index 杩涘叆 Last Order working-tree snapshot锛屼綔涓?worker worktree 鍩虹嚎銆傚瓨鍦ㄤ簬鏈彁浜ゆ敼鍔ㄣ€乽nborn 浠撳簱鎴栦笉鍚屾墍鏈夋潈鐩綍鏃朵篃鎸夊悓涓€ snapshot 鏈哄埗澶勭悊銆傜洰褰曚笉瀛樺湪鎴栬矾寰勪笉鏄洰褰曟椂浠嶄細鏄庣‘鎶ラ敊銆?
鍙€夊弬鏁帮細

```powershell
node bin/last-order.js --project D:\your\project --manager codex --worker codex --max-workers 4 --silence-minutes 10
```

濡?CLI 鍛戒护涓嶅湪 PATH锛屽彲璁剧疆 `LO_CLAUDE_COMMAND`銆乣LO_CODEX_COMMAND`銆乣LO_DSH_COMMAND`銆乣LO_OPENCODE_COMMAND`锛屽€间负鍙墽琛屾枃浠舵垨 Node CLI 鍏ュ彛鐨勭粷瀵硅矾寰勩€傛敮鎸佸父瑙?npm Windows `.cmd` 鍚姩鍣紱涓嶄細灏嗙敤鎴烽渶姹傛嫾鎺ユ垚 shell 鍛戒护銆?
闇€瑕佺郴缁熶腑鐨?`last-order` / `lo` 鍛戒护鏃讹紝鍙嚜琛屽湪鏈洰褰曡繍琛?`npm link`锛涚洿鎺ョ敤 `node bin/last-order.js` 涓嶉渶瑕佸叏灞€瀹夎銆?
## TUI 鎿嶄綔

Tab锛堟垨 Shift+Tab锛夊彧鍦?Manager 鍜?Workers 涓や釜涓荤晫闈箣闂村垏鎹€侻anager 鐣岄潰鐢?鈫戔啌 璋冨嚭杈撳叆鍘嗗彶锛岀敤 Shift+鈫戔啌 鎴?PgUp/PgDn 婊氬姩瀵硅瘽銆俉orkers 鐣岄潰宸︿晶鏄?worker 鍒楄〃锛屽彸渚ф槸璇︽儏锛汧6 鍦ㄥ垪琛ㄥ拰璇︽儏闂村垏鎹㈢劍鐐癸紝鈫戔啌 闅忕劍鐐归€夋嫨 worker 鎴栨粴鍔ㄨ鎯咃紝鈫愨啋 鍒囨崲瀵硅瘽銆佸伐浣滃尯鍜?Git銆係hift+鈫戔啌銆丆trl+鈫戔啌 鍜?PgUp/PgDn 濮嬬粓婊氬姩璇︽儏锛涚獎缁堢鑷姩鏀逛负涓婁笅鎺掑垪銆?椤堕儴鐘舵€佸尯鎸夆€滈」鐩?/ 鐘舵€?/ 闃熷垪 / 鎻愮ず鈥濆垎琛岀缉杩涘睍绀猴紝绐勭粓绔細鍘嬬缉涓哄崟琛屾垨鑷姩鎹㈣銆傚揩鎹烽敭鎻愮ず鍙湪 `/settings` 涓叧闂紱鍏抽棴鍚庝笉鍗犵敤椤堕儴绌洪棿銆?杈撳叆 `/monitor [worker_id]` 鍙湪鐙珛 Windows 鎺у埗鍙扮獥鍙ｇ洃瑙?worker锛涚渷鐣?ID 鏃朵娇鐢ㄥ綋鍓嶉€変腑鐨?worker銆傜洃鎺ц繘绋嬪彧璇婚」鐩?SQLite 鐘舵€侊紝涓嶈幏鍙栨湇鍔￠攣锛屾瘡 500ms 鍒锋柊銆傜獥鍙ｅ鐢ㄤ富 TUI 鐨勫畬鏁村璇濇覆鏌擄紝鍖呮嫭娑堟伅杈规銆佸伐鍏峰弬鏁板拰缁撴灉锛涙敮鎸?鈫戔啌/PgUp/PgDn 婊氬姩銆丠ome/End銆丗5 灞曞紑鍚庡彴杩囩▼鍜岀粓绔師鐢熼€夋嫨澶嶅埗銆傚叧闂獥鍙ｆ垨鎸?Ctrl+C 鍋滄銆?
榧犳爣鎷栭€夋ā寮忕敱椤圭洰閰嶇疆 `mouseSelection` 鎺у埗锛岄粯璁?`native`锛歍UI 鍏抽棴榧犳爣鎹曡幏锛岀洿鎺ユ嫋閫変笌澶嶅埗瀹屽叏鐢辩粓绔鐞嗐€傝缃负 `app` 鍚庯紝TUI 浣跨敤 `?1002h` 鎺ユ敹鎷栧姩杩囩▼浜嬩欢骞跺疄鏃堕珮浜紱閫夊尯鎸夊璇濆唴瀹瑰畾浣嶏紝婊氳疆鎴栭敭鐩樻粴鍔ㄦ椂楂樹寒璺熼殢鏂囨湰锛涙嫋鍒拌鍙ｄ笂涓嬭竟缂樹細鎸佺画鑷姩婊氬姩骞舵墿灞曢€夊尯銆傛澗寮€涓嶄細鑷姩澶嶅埗锛屾寜 Ctrl+C 鎵嶅鍒跺苟杩囨护娑堟伅杈规瀛楃锛屽鍒舵垚鍔熷悗鑷姩娓呴櫎閫夊尯銆侰trl+V 浼氳鍙栫郴缁熷壀璐存澘骞舵彃鍏ヨ緭鍏ユ銆?
- TUI fenced code blocks expose a clickable `[copy code]` OSC 8 link. File mentions such as `{{file:src/app.ts#L10-L20}}` and inline code paths like `src/app.ts:10-20` are underlined and open the selected VSCode lines when clicked.
宸ュ叿璋冪敤銆佸懡浠よ緭鍑哄拰 manager 鍥犲悗鍙拌繘搴﹂€氱煡浜х敓鐨勬鏌?鍥炲榛樿鎶樺彔锛岀浉閭昏繃绋嬪悎涓轰竴缁勫苟鏄剧ず娑夊強鐨勫伐鍏锋爮涓庢潯鏁般€傚睍寮€鍚庢瘡鏉″伐鍏疯褰曟樉绀哄悕绉般€佺姸鎬併€佽皟鐢?ID銆佸畬鏁村弬鏁帮紝浠ュ強閫€鍑虹爜銆佽€楁椂銆佺粨鏋滄垨閿欒銆傛寮忓洖澶嶃€佹渶缁堜氦浠樸€佺敤鎴烽棶棰樹笌閿欒淇濇寔鍙銆傛姌鍙犲彧褰卞搷鏄剧ず锛屽畬鏁存棩蹇椾粛淇濈暀銆?
杈撳叆 `/` 浼氬湪杈撳叆妗嗗唴鏄剧ず娴呰壊琛ュ叏棰勮鍜岀敤閫旇鏄庯紝缁х画杈撳叆浼氱瓫閫夊€欓€夛紱鈫戔啌 鍒囨崲锛孴ab 鎴?Enter 濉叆锛孍sc 鏀惰捣銆傛鍦ㄦ祻瑙堣緭鍏ュ巻鍙叉椂锛屸啈鈫?缁х画鍒囨崲鍘嗗彶锛涢噸鏂扮紪杈戞垨 Tab 濉叆鍚庯紝鈫戔啌 鎭㈠鍒囨崲琛ュ叏鍊欓€夈€傝ˉ鍏ㄥ彧淇敼杈撳叆妗嗭紝瀹屾暣鍛戒护鍐嶆 Enter 鎵嶆墽琛岋紱鐩存帴杈撳叆瀹屾暣鍛戒护涔熷彲浠ユ甯告墽琛屻€傚弬鏁颁細鎻愮ず褰撳墠 worker銆佸緟瀹℃壒 ID銆佸緟绛旈棶棰?ID銆佽繃绋嬬粍鍙峰拰 Git 姣旇緝鑼冨洿锛宍/open` 鏀寔閫変腑 worker 宸ヤ綔鍖哄唴鐨勭洰褰曚笌鏂囦欢锛堝惈涓枃鍜岀┖鏍硷級銆傛病鏈夎ˉ鍏ㄥ€欓€夋椂 Tab 淇濇寔鍘熸潵鐨勪富鐣岄潰鍒囨崲锛汼hift+Tab 濮嬬粓鍒囨崲涓荤晫闈€?
| 鎿嶄綔 | 鐢ㄩ€?|
| --- | --- |
| Enter / Ctrl+Enter | Enter 发送给 manager；Ctrl+Enter 在输入框内换行 |
| Tab | 只用于命令补全；补全关闭时不切换页面 |
| Ctrl+Tab | 切换 Manager / Workers 主界面 |
| `/`銆佲啈鈫撱€丒sc | 鍦ㄨ緭鍏ユ鍐呮樉绀哄€欓€夈€佸垏鎹㈠€欓€夈€佹敹璧疯ˉ鍏紱鏀惰捣鍚庢柟鍚戦敭鎭㈠鍘嗗彶杈撳叆鎴?worker 閫夋嫨 |
| 鈫戔啌 | Manager 璋冨嚭杈撳叆鍘嗗彶锛沇orkers 鏍规嵁鐒︾偣閫夋嫨 worker 鎴栨粴鍔ㄨ鎯?|
| F6 | Workers 鍐呭垏鎹㈠垪琛?/ 璇︽儏鐒︾偣锛岀劍鐐逛綅缃樉绀哄湪鏍囬涓?|
| `/monitor [worker_id]` | 鍦ㄧ嫭绔嬫帶鍒跺彴绐楀彛鐩戣鎸囧畾 worker锛涚渷鐣?ID 鏃剁洃瑙嗗綋鍓嶉€変腑 worker |
| 鈫愨啋 | 杈撳叆鏈夊唴瀹规椂绉诲姩鍏夋爣锛涜緭鍏ヤ负绌烘椂 Workers 鍒囨崲瀵硅瘽銆佸伐浣滃尯銆丟it |
| Shift+鈫愨啋 / Ctrl+A | 閫夋嫨杈撳叆鍐呭 / 鍏ㄩ€夎緭鍏ユ锛涜緭鍏ュ拰 Delete 浼氭浛鎹㈤€夊尯 |
| Shift+鈫戔啌 / Ctrl+鈫戔啌 | 鐩存帴婊氬姩褰撳墠瀵硅瘽鎴栬鎯咃紝涓嶆敼鍙?worker 閫夋嫨 |
| `/manager` / `/workers` | 鐩存帴鎵撳紑瀵瑰簲涓荤晫闈?|
| `/archive [worker_id|all]` | 手动归档已停止 worker；归档后只读且不能恢复 |
| `/interrupt 娑堟伅` | 鍋滄 manager 褰撳墠杞锛屾仮澶嶅師鐢熶細璇濆苟浼樺厛澶勭悊鏂拌緭鍏ワ紱worker 榛樿缁х画 |
| F1 / F2 / F3 / F4 | manager 瀵硅瘽 / 閫変腑 worker 瀵硅瘽 / 宸ヤ綔鍖?/ Git |
| F5 | 灞曞紑 / 鎶樺彔褰撳墠瀵硅瘽鐨勫叏閮ㄥ悗鍙拌繃绋?|
| `/expand 缁勫彿`銆乣/collapse 缁勫彿` | 鍗曠嫭灞曞紑 / 鎶樺彔涓€缁勶紱鍙傛暟 `all` 琛ㄧず鍏ㄩ儴 |
| `/w` | 打开 Workers 界面 |
| `/msg worker_id 消息` | 向指定 worker 发消息，操作同步给 manager |
| `/pause`銆乣/resume`銆乣/cancel`銆乣/retry 鍘熷洜` | 鎺у埗閫変腑 worker 浠诲姟 |
| `/select worker_id` | 鎸?ID 閫夋嫨 worker |
| `/open 鐩稿璺緞`銆乣/back` | 鏌ョ湅鏂囦欢鎴栫洰褰曪紱棣栫増涓哄彧璇婚瑙?|
| `/diff task` | 鑷 worker 鍩虹鐗堟湰浠ユ潵鐨勭疮璁℃敼鍔紝鎻愪氦鍚庝粛鍙煡鐪?|
| `/diff uncommitted` | 褰撳墠鏈彁浜ょ殑 tracked diff锛涙湭璺熻釜鏂囦欢鍒楀湪鐘舵€佷腑 |
| `/refresh` | 鍒锋柊褰撳墠宸ヤ綔鍖烘垨 Git 椤甸潰 |
| `/approval ID` | 鎵撳紑瀹屾暣 CLI 鏉冮檺璇锋眰锛孭gUp/PgDn 婊氬姩鏌ョ湅 |
| `/approve ID`銆乣/deny ID` | 鐢ㄦ埛鎵瑰噯鎴栨嫆缁濓紱涓嶆墿灞曚负浼氳瘽姘镐箙鑷姩鎵瑰噯 |
| `/question ID`銆乣/answer ID 绛斿` | 鏌ョ湅鍜屽洖绛斿師鐢熼棶棰橈紱worker 闇€姹傞棶棰樺悓鏃堕€氱煡 manager |
| `/settings` | 缂栬緫 Manager/Worker 鐨?provider銆乵odel銆乪ffort銆佽嚜瀹氫箟鎻愮ず璇嶃€佸鎵广€佸苟鍙戙€侀潤榛樸€侀紶鏍囨嫋閫夊拰蹇嵎閿彁绀猴紱Ctrl+S 淇濆瓨锛孍sc 鍙栨秷 |
| `/memory status\|new\|clear` | 查看 Manager native thread；`clear`开启新会话并清空消息区，保留任务、AGENTS 和审计历史 |
| `/skills` | 查看统一 Skill Registry；输入 `$` 补全，`$skill-name` 显式选择后注入完整 SKILL.md |

Last Order 鏄?Windows 涓婄殑 coding-agent 宸ヤ綔鍖猴紝涓€涓?manager 瀵规帴鐢ㄦ埛锛孧ission Control 涓ぎ鏈嶅姟绠＄悊鐙珛 worker 浠诲姟銆乵anager 鑷敤澶囨敞鍜屽畬鎴愬洖璋冦€俶anager 鍜岄粯璁?worker 鍙垎鍒€夋嫨 Claude Code銆丆odex銆丏eepSeek Harness 鎴?OpenCode銆?
褰撳墠鐗堟湰鎻愪緵鍙繍琛岀殑璋冨害绯荤粺涓?TUI銆佸洓绫诲師鐢熷崗璁€傞厤鍣ㄥ拰鑷姩鍖栨祴璇曘€傚簲鐢ㄥ彧杩炴帴閫夊畾鐨勭湡瀹?CLI锛屾部鐢ㄥ叾鐧诲綍涓庢ā鍨嬮厤缃€侰odex 鐨勭湡瀹?manager 鈫?瀹炵幇 worker 鈫?鐙珛楠屾敹 鈫?浜や粯鍒嗘敮闂幆宸茶窇閫氾紱鍏朵粬涓夌被鐨勭湡瀹炴ā鍨嬮棴鐜殏鏈畬鎴愩€?
## 鍚姩

闇€瑕?Node.js **24+**銆丟it锛屼互鍙婂噯澶囦娇鐢ㄧ殑 CLI锛涙部鐢ㄥ悇 CLI 宸叉湁鐨勭櫥褰曚笌妯″瀷閰嶇疆銆傛湰椤圭洰娌℃湁绗笁鏂?npm 杩愯渚濊禆銆?
鍦ㄤ氦浜掔粓绔惎鍔紝鎸囧畾椤圭洰鐩綍锛堝凡鏈?Git 浠撳簱鎴栨柊寤虹殑绌虹洰褰曪級锛?
```powershell
npm start -- --project D:\your\project --manager codex --worker codex
```

涔熷彲鐩存帴浣跨敤鍛戒护琛屽叆鍙ｏ細

```powershell
node bin/last-order.js doctor
node bin/last-order.js --project D:\your\project --manager codex --worker codex
```

杞戒綋鍚嶇О涓?`claude`銆乣codex`銆乣dsh`銆乣opencode`銆傞娆℃湭鎸囧畾鏃跺彲浜や簰閫夋嫨锛屼箣鍚庝繚瀛樺湪璇ラ」鐩厤缃腑銆傝繘鍏?TUI 鍚庡彲鐢?`/settings` 淇敼 Manager 鍜岄粯璁?Worker 鐨?provider銆乵odel銆乪ffort锛屼互鍙?Codex 瀹℃壒鏂瑰紡銆佹渶澶у苟鍙戝拰闈欓粯闃堝€硷紱淇濆瓨鍚庡啓鍥為」鐩厤缃紝閲嶅惎 Last Order 鐢熸晥銆俶odel/effort 瀛楁鎸?Enter 杩涘叆鏂囨湰缂栬緫锛孋trl+S 淇濆瓨銆俙--manager`銆乣--worker` 绛夊惎鍔ㄥ弬鏁板彧瑕嗙洊鏈杩愯锛屽苟浼氬湪鍚姩鏃舵洿鏂伴」鐩厤缃€?
Codex worker 榛樿鍚敤 **Approve for me**锛氱敱 Codex 鍘熺敓 `auto_review` 瀹℃壒鍣ㄥ垽鏂渶瑕佹巿鏉冪殑鎿嶄綔锛屾棩甯镐换鍔℃棤闇€閫愰」杈撳叆鎵瑰噯鍛戒护銆傞渶瑕佹墜鍔ㄥ鎵规椂锛屽惎鍔ㄥ弬鏁版坊鍔?`--codex-approvals user`锛涙仮澶嶈嚜鍔ㄥ鎵逛娇鐢?`--codex-approvals auto_review`锛岄€夋嫨淇濆瓨鍦ㄩ」鐩厤缃腑銆俶anager 淇濇寔鍙鏉冮檺銆?
鏂伴」鐩彧闇€鍏堝垱寤轰竴涓┖鐩綍銆侺astOrder 棣栨鍚姩浼氫负璇ョ┖鐩綍鍒濆鍖?Git锛坄main` 鍒嗘敮锛夊苟鍒涘缓涓嶅寘鍚枃浠剁殑鍒濆鎻愪氦锛涙棤闇€棰勫厛閰嶇疆 Git 鎻愪氦韬唤锛屼篃涓嶄慨鏀瑰叏灞€ Git 閰嶇疆銆?
闈?Git 鐩綍浼氳嚜鍔ㄥ垵濮嬪寲 Git 骞跺缓绔嬬┖鍩虹嚎锛涘凡鏈夋枃浠朵笉浼氳 stage 鎴栨彁浜ゅ埌 main锛岃€屾槸閫氳繃涓存椂 index 杩涘叆 Last Order working-tree snapshot锛屼綔涓?worker worktree 鍩虹嚎銆傚瓨鍦ㄤ簬鏈彁浜ゆ敼鍔ㄣ€乽nborn 浠撳簱鎴栦笉鍚屾墍鏈夋潈鐩綍鏃朵篃鎸夊悓涓€ snapshot 鏈哄埗澶勭悊銆傜洰褰曚笉瀛樺湪鎴栬矾寰勪笉鏄洰褰曟椂浠嶄細鏄庣‘鎶ラ敊銆?
鍙€夊弬鏁帮細

```powershell
node bin/last-order.js --project D:\your\project --manager codex --worker codex --max-workers 4 --silence-minutes 10
```

濡?CLI 鍛戒护涓嶅湪 PATH锛屽彲璁剧疆 `LO_CLAUDE_COMMAND`銆乣LO_CODEX_COMMAND`銆乣LO_DSH_COMMAND`銆乣LO_OPENCODE_COMMAND`锛屽€间负鍙墽琛屾枃浠舵垨 Node CLI 鍏ュ彛鐨勭粷瀵硅矾寰勩€傛敮鎸佸父瑙?npm Windows `.cmd` 鍚姩鍣紱涓嶄細灏嗙敤鎴烽渶姹傛嫾鎺ユ垚 shell 鍛戒护銆?
闇€瑕佺郴缁熶腑鐨?`last-order` / `lo` 鍛戒护鏃讹紝鍙嚜琛屽湪鏈洰褰曡繍琛?`npm link`锛涚洿鎺ョ敤 `node bin/last-order.js` 涓嶉渶瑕佸叏灞€瀹夎銆?
## TUI 鎿嶄綔

Tab锛堟垨 Shift+Tab锛夊彧鍦?Manager 鍜?Workers 涓や釜涓荤晫闈箣闂村垏鎹€侻anager 鐣岄潰鐢?鈫戔啌 璋冨嚭杈撳叆鍘嗗彶锛岀敤 Shift+鈫戔啌 鎴?PgUp/PgDn 婊氬姩瀵硅瘽銆俉orkers 鐣岄潰宸︿晶鏄?worker 鍒楄〃锛屽彸渚ф槸璇︽儏锛汧6 鍦ㄥ垪琛ㄥ拰璇︽儏闂村垏鎹㈢劍鐐癸紝鈫戔啌 闅忕劍鐐归€夋嫨 worker 鎴栨粴鍔ㄨ鎯咃紝鈫愨啋 鍒囨崲瀵硅瘽銆佸伐浣滃尯鍜?Git銆係hift+鈫戔啌銆丆trl+鈫戔啌 鍜?PgUp/PgDn 濮嬬粓婊氬姩璇︽儏锛涚獎缁堢鑷姩鏀逛负涓婁笅鎺掑垪銆?椤堕儴鐘舵€佸尯鎸夆€滈」鐩?/ 鐘舵€?/ 闃熷垪 / 鎻愮ず鈥濆垎琛岀缉杩涘睍绀猴紝绐勭粓绔細鍘嬬缉涓哄崟琛屾垨鑷姩鎹㈣銆傚揩鎹烽敭鎻愮ず鍙湪 `/settings` 涓叧闂紱鍏抽棴鍚庝笉鍗犵敤椤堕儴绌洪棿銆?杈撳叆 `/monitor [worker_id]` 鍙湪鐙珛 Windows 鎺у埗鍙扮獥鍙ｇ洃瑙?worker锛涚渷鐣?ID 鏃朵娇鐢ㄥ綋鍓嶉€変腑鐨?worker銆傜洃鎺ц繘绋嬪彧璇婚」鐩?SQLite 鐘舵€侊紝涓嶈幏鍙栨湇鍔￠攣锛屾瘡 500ms 鍒锋柊銆傜獥鍙ｅ鐢ㄤ富 TUI 鐨勫畬鏁村璇濇覆鏌擄紝鍖呮嫭娑堟伅杈规銆佸伐鍏峰弬鏁板拰缁撴灉锛涙敮鎸?鈫戔啌/PgUp/PgDn 婊氬姩銆丠ome/End銆丗5 灞曞紑鍚庡彴杩囩▼鍜岀粓绔師鐢熼€夋嫨澶嶅埗銆傚叧闂獥鍙ｆ垨鎸?Ctrl+C 鍋滄銆?
榧犳爣鎷栭€夋ā寮忕敱椤圭洰閰嶇疆 `mouseSelection` 鎺у埗锛岄粯璁?`native`锛歍UI 鍏抽棴榧犳爣鎹曡幏锛岀洿鎺ユ嫋閫変笌澶嶅埗瀹屽叏鐢辩粓绔鐞嗐€傝缃负 `app` 鍚庯紝TUI 浣跨敤 `?1002h` 鎺ユ敹鎷栧姩杩囩▼浜嬩欢骞跺疄鏃堕珮浜紱閫夊尯鎸夊璇濆唴瀹瑰畾浣嶏紝婊氳疆鎴栭敭鐩樻粴鍔ㄦ椂楂樹寒璺熼殢鏂囨湰锛涙嫋鍒拌鍙ｄ笂涓嬭竟缂樹細鎸佺画鑷姩婊氬姩骞舵墿灞曢€夊尯銆傛澗寮€涓嶄細鑷姩澶嶅埗锛屾寜 Ctrl+C 鎵嶅鍒跺苟杩囨护娑堟伅杈规瀛楃锛屽鍒舵垚鍔熷悗鑷姩娓呴櫎閫夊尯銆侰trl+V 浼氳鍙栫郴缁熷壀璐存澘骞舵彃鍏ヨ緭鍏ユ銆?
宸ュ叿璋冪敤銆佸懡浠よ緭鍑哄拰 manager 鍥犲悗鍙拌繘搴﹂€氱煡浜х敓鐨勬鏌?鍥炲榛樿鎶樺彔锛岀浉閭昏繃绋嬪悎涓轰竴缁勫苟鏄剧ず娑夊強鐨勫伐鍏锋爮涓庢潯鏁般€傚睍寮€鍚庢瘡鏉″伐鍏疯褰曟樉绀哄悕绉般€佺姸鎬併€佽皟鐢?ID銆佸畬鏁村弬鏁帮紝浠ュ強閫€鍑虹爜銆佽€楁椂銆佺粨鏋滄垨閿欒銆傛寮忓洖澶嶃€佹渶缁堜氦浠樸€佺敤鎴烽棶棰樹笌閿欒淇濇寔鍙銆傛姌鍙犲彧褰卞搷鏄剧ず锛屽畬鏁存棩蹇椾粛淇濈暀銆?
杈撳叆 `/` 浼氬湪杈撳叆妗嗗唴鏄剧ず娴呰壊琛ュ叏棰勮鍜岀敤閫旇鏄庯紝缁х画杈撳叆浼氱瓫閫夊€欓€夛紱鈫戔啌 鍒囨崲锛孴ab 鎴?Enter 濉叆锛孍sc 鏀惰捣銆傛鍦ㄦ祻瑙堣緭鍏ュ巻鍙叉椂锛屸啈鈫?缁х画鍒囨崲鍘嗗彶锛涢噸鏂扮紪杈戞垨 Tab 濉叆鍚庯紝鈫戔啌 鎭㈠鍒囨崲琛ュ叏鍊欓€夈€傝ˉ鍏ㄥ彧淇敼杈撳叆妗嗭紝瀹屾暣鍛戒护鍐嶆 Enter 鎵嶆墽琛岋紱鐩存帴杈撳叆瀹屾暣鍛戒护涔熷彲浠ユ甯告墽琛屻€傚弬鏁颁細鎻愮ず褰撳墠 worker銆佸緟瀹℃壒 ID銆佸緟绛旈棶棰?ID銆佽繃绋嬬粍鍙峰拰 Git 姣旇緝鑼冨洿锛宍/open` 鏀寔閫変腑 worker 宸ヤ綔鍖哄唴鐨勭洰褰曚笌鏂囦欢锛堝惈涓枃鍜岀┖鏍硷級銆傛病鏈夎ˉ鍏ㄥ€欓€夋椂 Tab 淇濇寔鍘熸潵鐨勪富鐣岄潰鍒囨崲锛汼hift+Tab 濮嬬粓鍒囨崲涓荤晫闈€?
| 鎿嶄綔 | 鐢ㄩ€?|
| --- | --- |
| Enter / Ctrl+Enter | Enter 在输入框内换行；Ctrl+Enter 才发送给 manager |
| Tab | 只用于命令补全；补全关闭时不切换页面 |
| Ctrl+Tab | 切换 Manager / Workers 主界面 |
| `/`銆佲啈鈫撱€丒sc | 鍦ㄨ緭鍏ユ鍐呮樉绀哄€欓€夈€佸垏鎹㈠€欓€夈€佹敹璧疯ˉ鍏紱鏀惰捣鍚庢柟鍚戦敭鎭㈠鍘嗗彶杈撳叆鎴?worker 閫夋嫨 |
| 鈫戔啌 | Manager 璋冨嚭杈撳叆鍘嗗彶锛沇orkers 鏍规嵁鐒︾偣閫夋嫨 worker 鎴栨粴鍔ㄨ鎯?|
| F6 | Workers 鍐呭垏鎹㈠垪琛?/ 璇︽儏鐒︾偣锛岀劍鐐逛綅缃樉绀哄湪鏍囬涓?|
| `/monitor [worker_id]` | 鍦ㄧ嫭绔嬫帶鍒跺彴绐楀彛鐩戣鎸囧畾 worker锛涚渷鐣?ID 鏃剁洃瑙嗗綋鍓嶉€変腑 worker |
| 鈫愨啋 | 杈撳叆鏈夊唴瀹规椂绉诲姩鍏夋爣锛涜緭鍏ヤ负绌烘椂 Workers 鍒囨崲瀵硅瘽銆佸伐浣滃尯銆丟it |
| Shift+鈫愨啋 / Ctrl+A | 閫夋嫨杈撳叆鍐呭 / 鍏ㄩ€夎緭鍏ユ锛涜緭鍏ュ拰 Delete 浼氭浛鎹㈤€夊尯 |
| Shift+鈫戔啌 / Ctrl+鈫戔啌 | 鐩存帴婊氬姩褰撳墠瀵硅瘽鎴栬鎯咃紝涓嶆敼鍙?worker 閫夋嫨 |
| `/manager` / `/workers` | 鐩存帴鎵撳紑瀵瑰簲涓荤晫闈?|
| `/interrupt 娑堟伅` | 鍋滄 manager 褰撳墠杞锛屾仮澶嶅師鐢熶細璇濆苟浼樺厛澶勭悊鏂拌緭鍏ワ紱worker 榛樿缁х画 |
| F1 / F2 / F3 / F4 | manager 瀵硅瘽 / 閫変腑 worker 瀵硅瘽 / 宸ヤ綔鍖?/ Git |
| F5 | 灞曞紑 / 鎶樺彔褰撳墠瀵硅瘽鐨勫叏閮ㄥ悗鍙拌繃绋?|
| `/expand 缁勫彿`銆乣/collapse 缁勫彿` | 鍗曠嫭灞曞紑 / 鎶樺彔涓€缁勶紱鍙傛暟 `all` 琛ㄧず鍏ㄩ儴 |
| `/w` | 打开 Workers 界面 |
| `/msg worker_id 消息` | 向指定 worker 发消息，操作同步给 manager |
| `/pause`銆乣/resume`銆乣/cancel`銆乣/retry 鍘熷洜` | 鎺у埗閫変腑 worker 浠诲姟 |
| `/select worker_id` | 鎸?ID 閫夋嫨 worker |
| `/open 鐩稿璺緞`銆乣/back` | 鏌ョ湅鏂囦欢鎴栫洰褰曪紱棣栫増涓哄彧璇婚瑙?|
| `/diff task` | 鑷 worker 鍩虹鐗堟湰浠ユ潵鐨勭疮璁℃敼鍔紝鎻愪氦鍚庝粛鍙煡鐪?|
| `/diff uncommitted` | 褰撳墠鏈彁浜ょ殑 tracked diff锛涙湭璺熻釜鏂囦欢鍒楀湪鐘舵€佷腑 |
| `/refresh` | 鍒锋柊褰撳墠宸ヤ綔鍖烘垨 Git 椤甸潰 |
| `/approval ID` | 鎵撳紑瀹屾暣 CLI 鏉冮檺璇锋眰锛孭gUp/PgDn 婊氬姩鏌ョ湅 |
| `/approve ID`銆乣/deny ID` | 鐢ㄦ埛鎵瑰噯鎴栨嫆缁濓紱涓嶆墿灞曚负浼氳瘽姘镐箙鑷姩鎵瑰噯 |
| `/question ID`銆乣/answer ID 绛斿` | 鏌ョ湅鍜屽洖绛斿師鐢熼棶棰橈紱worker 闇€姹傞棶棰樺悓鏃堕€氱煡 manager |
| `/settings` | 缂栬緫 Manager/Worker 鐨?provider銆乵odel銆乪ffort銆佽嚜瀹氫箟鎻愮ず璇嶃€佸鎵广€佸苟鍙戙€侀潤榛樸€侀紶鏍囨嫋閫夊拰蹇嵎閿彁绀猴紱Ctrl+S 淇濆瓨锛孍sc 鍙栨秷 |
| `/memory status\|new\|clear` | 查看 Manager native thread；`clear`开启新会话并清空消息区，保留任务、AGENTS 和审计历史 |
 会动态补全已安装 skill，Tab 填入 |
| `/reload` | CLI 由 supervisor 重启新进程；VSCode 停止服务后自动 Reload Window，重载扩展与 backend 并重新打开 Manager |
| 榧犳爣鎷栭€?| 榛樿浣跨敤缁堢鍘熺敓閫夋嫨锛涘簲鐢ㄥ眰妯″紡涓嬫嫋閫夊悗鎸?Ctrl+C 澶嶅埗锛屽苟杩囨护杈规瀛楃 |
| PgUp / PgDn | 婊氬姩褰撳墠鍐呭 |
| Home / End | 只用于输入框行首 / 行尾，不滚动内容 |
| Ctrl+P / Ctrl+N / Ctrl+U | 鍘嗗彶杈撳叆鍚戝墠 / 鍚戝悗 / 娓呯┖杈撳叆 |
| Ctrl+C / Ctrl+V | 搴旂敤灞傛湁閫夊尯鏃跺鍒跺苟杩囨护杈规锛涙棤閫夊尯鏃朵笉閫€鍑?TUI锛涚矘璐寸郴缁熷壀璐存澘 |
| `/help` | 鏌ョ湅瀹屾暣甯姪 |
| `/checkpoint [鍚嶇О]` | 鍒涘缓 workspace 涓庡師鐢熶細璇?checkpoint |
| `/checkpoints` | 鏌ョ湅 checkpoint 鍒楄〃 |
| `/restore id [files\|conversation\|all] confirm` | 鎭㈠ checkpoint锛屽繀椤讳簩娆＄‘璁?|
| `/turns [manager\|worker_id]` | 鏌ョ湅 provider 鍘熺敓 turns |
| `/quote [actor:]#seq <instruction>` | 引用 Manager/Worker 历史消息并发送给 Manager；Ctrl+Q 可引用选中文本 |
| `/fork turn_id [manager\|worker_id]` | 浠庡師鐢?turn fork 瀵硅瘽 |
| `/revert turn_id --yes [manager\|worker_id]` | 鍘熺敓鍥為€€瀵硅瘽鍘嗗彶锛屼笉鏀规枃浠?|
| `/quit` | 鍙€€鍑哄綋鍓?TUI锛孧ission Control 鍜?workers 缁х画杩愯 |
| `/shutdown` | 鍏抽棴 TUI锛屽苟鍋滄鏁翠釜 Last Order backend 绯荤粺 |

宸插畬鎴愭垨鍙栨秷鐨?worker 瑕佸厛鏄惧紡 `/retry`锛屽啀鍙戦€佹柊宸ヤ綔锛岄伩鍏嶅皢杈撳叆闈欓粯鎺掑埌涓嶄細缁х画鎵ц鐨勪細璇濄€傛櫘閫?worker 娑堟伅鍦ㄥ綋鍓嶈疆娆″畬鎴愬悗澶勭悊锛屼笉浼氳嚜鍔ㄦ墦鏂畠銆?
## Staff 妯″瀷閰嶇疆

Manager 鍜岄粯璁?Worker 鏄袱绫?staff锛屽垎鍒繚瀛?`provider`銆乣model`銆乣effort`銆傞」鐩粯璁ら厤缃负 manager/worker 鍧囦娇鐢?`codex`銆佹ā鍨?`deepseek-flash`銆乪ffort `high`銆傚彟鏈夊搴?CLI 瑕嗙洊鍙傛暟锛歚--manager-model`銆乣--manager-effort`銆乣--worker-model`銆乣--worker-effort`銆俙start_worker` 杩樺厑璁?manager 涓哄崟涓?worker 瑕嗙洊 provider/model/effort銆?
| Provider | Model | Effort | 褰撳墠鏄犲皠 |
| --- | --- | --- | --- |
| Codex | 鏀寔 | 鏀寔 | thread 鐨?`model` 涓?`config.model_reasoning_effort` |
| Claude Code | 鏀寔 | 鏀寔 | CLI `--model` 涓?`--effort` |
| OpenCode | 鏀寔 | 鏆備笉浼犻€?| agent 閰嶇疆涓殑 `model` |
| DeepSeek Harness | 鏆備笉浼犻€?| 鏆備笉浼犻€?| 褰撳墠 ACP 閫傞厤鍣ㄦ湭鏆撮湶杩欎袱涓弬鏁?|

## 鎻愮ず璇嶅垎灞備笌 Manager 璁板繂

- 浠ｇ爜鐢熸垚鐨勭郴缁熻鑹层€佸畨鍏ㄥ拰鏉冮檺瑙勫垯鏄浐瀹氱郴缁熸彁绀鸿瘝锛屼笉浼氳閰嶇疆瑕嗙洊銆?- `managerPrompt` 鍜?`workerPrompt` 鏄敤鎴峰彲缂栬緫鐨?staff 鎻愮ず璇嶏紝鍒嗗埆杩藉姞鍒?manager/worker 鎸囦护锛涘湪 `/settings` 涓寜 Enter 缂栬緫锛孋trl+J 鎹㈣銆?- manager 鍙€氳繃 `inspect` 璇诲彇 `prompt_config`锛屼簡瑙ｅ綋鍓?manager/worker 鑷畾涔夋彁绀鸿瘝鍜?manager 璁板繂璺緞銆?- 褰撶敤鎴疯姹傝浣忎範鎯€佸伐浣滆鑼冩垨宸ヤ綔娴佺▼鏃讹紝manager 搴旇皟鐢?`remember_manager_guidance`銆侻ission Control 灏嗗唴瀹硅拷鍔犲埌 `.git/last-order/AGENTS.md`锛屼笉淇敼椤圭洰婧愮爜鍜岄」鐩牴鐩綍鐨?AGENTS.md銆?- manager AGENTS.md 浼氳拷鍔犲埌鍚庣画 manager 绯荤粺鎸囦护涓紝浣嗕笌鍥哄畾绯荤粺瑙勫垯銆佺敤鎴峰彲缂栬緫 staff 鎻愮ず璇嶆槑纭垎鍖恒€?
Codex 浼氳瘽鏀寔鍘熺敓 turn 鏌ヨ銆乫ork 鍜屽巻鍙?revert銆侺astOrder control API 宸叉彁渚?/conversation/turns銆?conversation/fork銆?conversation/revert锛涙枃浠舵仮澶嶄粛鐢?Last Order 鐨?workspace snapshot 璐熻矗銆?
## VSCode 瀹㈡埛绔紙绗竴闃舵锛?
浠撳簱涓殑 `vscode-extension/` 鏄?Last Order backend 鐨勫紑鍙戠増 VSCode 鎵╁睍銆傚畠涓嶆妸 Last Order backend 鏀捐繘 extension host锛岃€屾槸鍚姩鐙珛 Node 鏈嶅姟鎴栭檮鐫€鍒板凡鏈夋湇鍔°€?

## Last Order backend 璋冨害琛屼负

- 仓库探索、架构梳理、工具链/test/CI 现状调研可以使用 `kind=explore` worker 执行；该类 worker 只读、不提交、不创建交付分支，通过 summary/evidence 回传发现。

- Last Order backend 鏄姸鎬併€亀orker 鍚姩鍜屽畬鎴愬洖璋冪殑涓ぎ鏈嶅姟銆傚綋鍓嶄骇鍝佽矾寰勪笉鍐嶄娇鐢ㄨ嚜鍔ㄦ帹杩涚殑绋嬪簭鍖栧闃舵绠＄嚎銆?- manager 閫氳繃 `start_worker` 涓€娆″惎鍔ㄤ竴涓嫭绔?worker 浠诲姟銆傚涓簰涓嶄緷璧栫殑浠诲姟鍙互骞惰锛屾湁鍏堝悗渚濊禆鐨勪换鍔″繀椤荤瓑鍓嶄竴涓畬鎴愬悗鍐嶅惎鍔ㄣ€?- manager 鍙湪鍒涘缓鏃舵垨 worker 杩愯涓娇鐢?`update_worker_notes` 淇濆瓨鍙粰鑷繁鐪嬬殑澶囨敞锛屼緥濡傚悗缁鏌ユ柟寮忔垨绛夊緟涓殑鏂伴渶姹傘€?- worker 瀹屾垚銆佸け璐ユ垨闃诲鏃讹紝Last Order backend 鎶婄粨鏋溿€佹彁浜ょ増鏈€亀orker 鏍囬鍜?manager 澶囨敞涓€璧峰洖浼犵粰 manager銆?- manager 鏍规嵁鍥炶皟鍐冲畾涓嬩竴姝ワ紱闇€瑕佷粠鍓嶄竴涓?worker 鐨勬彁浜ょ户缁椂锛岀敤 `input_worker_id` 鍚姩涓嬩竴涓?worker锛孧ission Control 浼氫互璇ユ彁浜ゅ垱寤烘柊鐨?worktree銆?- worker 蹇呴』璋冪敤 `report_result` 鎻愪氦鏄庣‘缁撴灉锛涜繘绋嬫甯搁€€鍑轰笉浠ｈ〃浠诲姟鎴愬姛銆傞獙鏀跺け璐ュ繀椤绘彁渚涜瘉鎹€?- 楠屾敹 worker 鍙柊澧炲苟鎻愪氦鐙珛娴嬭瘯鏂囦欢锛屼絾涓嶅緱淇敼宸叉湁瀹炵幇鎴栧凡鏈夋祴璇曘€傛湇鍔＄户缁牎楠屽疄闄?Git 宸紓銆?- worker 缁撴潫銆佷富鍔ㄦ眹鎶ヨ繘灞曟垨闀挎湡鏃犲搷搴旀椂閫氱煡 manager 妫€鏌ワ紱闈欓粯榛樿闃堝€?10 鍒嗛挓锛屼笉浼氭嵁姝ょ洿鎺ユ潃姝?worker銆?- 闇€姹傛敼鍔ㄦ眹鎬诲埌 `last-order/delivery/<request_id>`銆傚師宸ヤ綔鍒嗘敮涓嶄細鑷姩鍚堝苟銆?
## 鏁版嵁鍜屾仮澶?
鏈嶅姟鏄綋鍓嶅簲鐢ㄤ腑鐨勪腑澶ā鍧楋紝鎻愪緵鍙?token 淇濇姢鐨勬湰鏈轰复鏃跺伐鍏锋ˉ鎺ョ鍙ｏ紱涓嶇嫭绔嬪父椹汇€侰odex 閫氳繃鍘熺敓鍔ㄦ€佸伐鍏疯皟鐢紝鍏朵粬閫傞厤鍣ㄩ€氳繃鏈湴 stdio MCP 妗ユ帴銆?
椤圭洰鐨?Git common directory 涓嬩繚瀛?`last-order/`锛岄€氬父鏄細

```text
<project>/.git/last-order/
  config.json       staff 鐨?provider/model/effort/鎻愮ず璇嶅強鐣岄潰閰嶇疆
  AGENTS.md         manager 涓撳睘鎸佷箙璁板繂锛岀敱 remember_manager_guidance 鍐欏叆
  schedule.sqlite   worker 浠诲姟銆佹墽琛岀姸鎬併€佸師濮嬮渶姹傘€乵anager 澶囨敞銆佹秷鎭笌寰呭鐞嗛€氱煡
  service.lock      鍗曢」鐩崟鏈嶅姟閿?  native/           鍘熺敓 CLI 涓存椂鎺ュ叆閰嶇疆
```

worker 鏂囦欢浣嶄簬 `<project>/.last-order-workspaces/<worker_id>`锛岄€氳繃鏈湴 `.git/info/exclude` 鎺掗櫎锛屼笉淇敼椤圭洰鐨?`.gitignore`銆傚伐浣滃尯瀹瑰櫒璁板綍褰掑睘锛屼笉浼氭帴绠″凡瀛樺湪涓旀棤褰掑睘鏍囪鐨勫悓鍚嶇洰褰曘€傚伐浣滄枃浠朵笌 `.git` 鍏冩暟鎹垎寮€锛岄伩鍏?CLI 鐨?Git 鍏冩暟鎹彧璇讳繚鎶ゅ奖鍝嶆甯稿疄鐜般€?
`/quit` 鎴?Ctrl+D 鍙€€鍑?TUI锛汣trl+C 姘镐笉閫€鍑猴紝鏈夐€夊尯鏃跺鍒躲€佹棤閫夊尯鏃朵粎鎻愮ず銆侻ission Control銆乵anager 鍜?workers 缁х画杩愯锛屽彲鍦ㄧ◢鍚庨噸鏂伴檮鐫€銆俙/shutdown` 鎵嶅仠姝㈡暣涓郴缁熷苟閲婃斁鏈嶅姟閿侊紱璁板綍銆亀orktree 鍜屾仮澶嶇姸鎬佷粛淇濈暀銆傚師鐢熶細璇濅笉瀛樺湪銆佸伐浣滃尯涓㈠け鎴栫姸鎬佹棤娉曞畨鍏ㄧ‘璁ゆ椂鏄剧ず澶辫触骞堕€氱煡 manager锛屼笉浼氳嚜鍔ㄩ噸缃垨鍒犻櫎浠ｇ爜銆?
Windows 浣跨敤鐙珛鐩戠潱杩涚▼鐩戞祴鐖惰繘绋嬭繛鎺ュ苟鍥炴敹 CLI 杩涚▼鏍戙€傚仠姝㈡椂绛夊緟鎵ц涓庡洖鏀剁粨鏉熴€?
## 楠岃瘉涓庡綋鍓嶉檺鍒?
```powershell
npm test
npm run check
node scripts/probe-codex.js
```

鐪熷疄妯″瀷鑱旇皟鑴氭湰锛堜細浣跨敤鏈満 Codex 閰嶇疆鍙戣捣妯″瀷璇锋眰锛屽苟鏂板缓闅旂娴嬭瘯浠撳簱锛夛細

```powershell
node scripts/live-integration.js --provider codex --scenario greetings
node scripts/live-integration.js --provider codex --scenario full
```

绗竴鏉￠獙璇佺函瀵硅瘽涓嶆淳宸ワ紱绗簩鏉＄户缁獙璇佸甫闂€欑殑鐪熷疄浠ｇ爜浠诲姟銆佺嫭绔嬮獙鏀躲€佷氦浠樺拰浠诲姟鍚庣殑鎰熻阿銆侰odex 榛樿浣跨敤鍘熺敓鑷姩瀹℃壒锛涘墿浣欎汉宸ユ潈闄愯姹備粛闇€閫愰」澶勭悊銆傛姤鍛婁繚瀛樺湪 `.tmp/live-codex-*/report.json`銆?
`probe-codex.js` 鍙垵濮嬪寲 Codex 骞舵鏌ヤ复鏃剁嚎绋嬬殑宸ュ叿涓庤嚜鍔ㄥ鎵归厤缃紝**涓嶄細鍚姩妯″瀷杞**锛沗live-integration.js` 浼氬疄闄呰皟鐢ㄦā鍨嬨€傚彲杩愯 `node scripts/probe-codex-approval.js` 鍙戣捣涓€娆＄湡瀹炴ā鍨嬩笌鍘熺敓瀹℃壒娴嬭瘯锛氬湪闅旂浠撳簱鍒涘缓涓€涓┖鎻愪氦锛岄獙璇佽嚜鍔ㄥ鎵逛笖娌℃湁浜哄伐瀹℃壒璇锋眰銆?
宸查獙璇侊細89 椤硅嚜鍔ㄥ寲娴嬭瘯銆佺湡瀹?Git worktree 涓庝氦浠樺垎鏀€佸洓涓€傞厤鍣ㄧ殑鍙楁帶鍗忚瀛愯繘绋嬨€丮CP 瑙掕壊杈圭晫銆佸鎵广€佹櫘閫氬彂閫佷笌鎵撴柇銆侀噸鍚仮澶嶃€乄indows 鐖惰繘绋嬪紓甯搁€€鍑哄悗鐨勫瓙杩涚▼鍥炴敹锛屼互鍙婃秷鎭竟妗嗐€佹粴鍔ㄣ€佽緭鍏ュ巻鍙层€佺粓绔師鐢熼紶鏍囬€夋嫨銆侀厤缃寔涔呭寲銆佸簲鐢ㄥ眰鎷栭€夈€佸畬鏁村伐鍏疯皟鐢ㄦ棩蹇椼€佺嫭绔?Worker 鐩戣绐楀彛銆佸揩閫?reload銆佹粴鍔ㄨ窡闅忛€夊尯銆佸垎缁勯《閮ㄧ姸鎬併€佸彲閰嶇疆蹇嵎閿彁绀恒€丮ission Control 澶囨敞鍥炶皟銆乻taff model/effort 閰嶇疆銆佹彁绀鸿瘝鍒嗗眰銆乵anager AGENTS.md 璁板繂銆丮ission Control control API銆佸師鐢熶細璇?fork/revert銆亀orkspace checkpoint銆乂SCode 瀹㈡埛绔鏋跺拰 TUI service client銆侰odex `0.164.0` 鐨勭湡瀹炵函瀵硅瘽銆佸疄鐜板拰鐙珛楠屾敹銆丟it 瀹℃壒銆佷腑鏂仮澶嶅強浜や粯闂幆閫氳繃銆傜湡瀹炰换鍔′腑 18 椤规祴璇曢€氳繃锛屼氦浠樺悗鎰熻阿涓嶅鍔?worker 鎴栫绾裤€傝瑙?[鐪熷疄鑱旇皟鎶ュ憡](docs/integration/codex-live.md)锛涘師鐢熻嚜鍔ㄥ鎵圭殑鐪熷疄鎵ц楠岃瘉瑙?[鑷姩瀹℃壒鑱旇皟](docs/integration/codex-auto-review.md)銆?
Claude Code `2.1.316`銆丏SH `0.2.1-rc.5`銆丱penCode `1.19.5` 宸插畨瑁呭苟纭鍚姩銆傚叾鐪熷疄璇锋眰鍒嗗埆閬囧埌鏈櫥褰曘€佺己灏?DeepSeek key銆佸厤璐规ā鍨嬮搴﹁€楀敖锛涙寜鐢ㄦ埛褰撳墠瑕佹眰锛屼粎缁х画瀹屾垚 Codex 鑱旇皟銆傚叾浠栦笁绫讳粛涓嶈兘瑙嗕负宸查€氳繃鐪熷疄妯″瀷闂幆锛涘崗璁す鍏锋祴璇曚笉鑳芥浛浠ｇ湡瀹炶仈璋冦€?
manager 鐨勮亴璐ｉ€氳繃鎸囦护鍜屽悇杞戒綋鍙敤鐨勯檺鍒剁害鏉燂細Codex 浣跨敤鍙娌欑骞舵嫆缁濆崌绾ф潈闄愶紱Claude 绂佺敤鍐欏叆銆佸懡浠や笌鍘熺敓濮旀淳宸ュ叿锛汷penCode 瀵?manager 鎷掔粷 edit/bash/task锛汥SH 鐩墠渚濊禆瑙掕壊鎸囦护锛屽苟鎷掔粷浜ゅ埌瀹㈡埛绔殑鍐欏叆鎴栨墽琛屽鎵癸紝灏氭湭楠岃瘉鍏跺叏閮ㄥ師鐢熷伐鍏风殑涓ユ牸鐧藉悕鍗曘€?
棣栫増鏂囦欢棰勮涓婇檺涓?256 KB锛屼笉鎻愪緵缂栬緫鍣ㄦ垨鍘熺敓缁堢宓屽銆傚伐浣滃尯鍜?Git 椤甸潰鎸夐渶鍒锋柊锛涘璇濄€佺姸鎬佷笌瀹℃壒瀹炴椂鏇存柊銆傛湭鎻愪緵瀹夎鍣ㄦ垨鎵撳寘鍚庣殑 Windows `.exe`銆?
闇€姹備笌璁捐鍘嗗彶瑙?[闇€姹傝褰昡(docs/requirements.md)銆乕绯荤粺璁捐](docs/architecture.md)銆乕CLI 鎺ュ叆璇佹嵁](docs/cli-integration.md)銆乕ADR](docs/adr/)銆?

- The VSCode Manager Webview supports up to eight PNG/JPEG/GIF/WebP attachments with thumbnail previews; Codex receives them as native `localImage` inputs.

## Linux troubleshooting

- Extension upgrades reject incompatible detached backends and restart from the bundled backend after saving interrupted state.
- Codex `paginated_threads` resume failures fall back to a fresh native thread while preserving Last Order history and task state.
- SSH sessions without X11 or Wayland use the terminal paste shortcut `Ctrl+Shift+V` or `Shift+Insert`.
- Run `/version` to inspect the active Last Order build, Mission Control protocol, provider configuration, platform, and project path.
- See [Troubleshooting](docs/troubleshooting.md) for diagnostics and `LO_CODEX_COMMAND` configuration.

## Native Manager Webview

The VSCode extension now uses native DOM for all product UI. The Manager view contains Manager and Workers surfaces, a fixed message composer, image attachments, approvals and questions, worker conversation/status controls, workspace and Git previews, message quoting, provider-native turn fork/revert, settings, checkpoints, skills, and a command sheet. It no longer packages or launches xterm, a Webview terminal host, or a VSCode terminal monitor. The `last-order` command line application retains its own terminal interface independently.

Webview messages turn code-formatted file paths into editor links. The Composer also provides editor-selection insertion, per-target draft/history, slash-command compatibility, and a fixed layout at sidebar widths.
