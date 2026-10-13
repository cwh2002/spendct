/**
 * 案例库单一来源（/learn 浏览产品与后续 RAG 引用共用，04 §2 案例 schema 的浏览版投影）：
 * 8 类共 24 条精选案例，每条附可核验来源（12315 / 消保法条文号 / 官方平台规则页）。
 * 内容纪律（04 §12）：来源必须可访问、法条引用现行有效条文、
 * 学生权益类填写 benefitTags（student_cert/edu_discount/campus_card/budget_substitute/rights_tip）。
 * 全量 150 条案例在 data/cases 维护（RAG 数据源），本文件是省赛窗口的浏览子集，
 * 后续扩容只在此追加，页面消费方零改动。
 */

export interface CaseRecord {
  /** 稳定标识：category 前缀 + 序号，供收藏/埋点引用 */
  id: string;
  title: string;
  summary: string;
  /** 8 类之一，见 CATEGORY_LABELS */
  category: string;
  /** 来源名称（机构/平台/栏目），配合 sourceUrl 可核验 */
  source: string;
  /** 来源链接：官方平台规则页或机构官网 */
  sourceUrl: string;
  /** 法条/规则依据（可核验的现行有效条文） */
  legalBasis?: string;
  /** 学生权益标签（仅 student_benefits 类填写，04 §2 五枚可选值） */
  benefitTags: string[];
}

/** 8 类中文名：chips 与徽标共用，顺序即展示顺序 */
export const CATEGORY_LABELS: Record<string, string> = {
  subscription_trap: "订阅陷阱",
  prepaid_risk: "预付风险",
  minor_spending: "冲动消费",
  consumer_rights: "消费维权",
  platform_rule: "平台规则",
  regulation: "法律法规",
  spending_advice: "省钱建议",
  student_benefits: "学生权益",
};

export const CASES: CaseRecord[] = [
  // —— 订阅陷阱 subscription_trap ×4 ——
  {
    id: "st-001",
    title: "视频平台连续包月：首月 1 元，次月 15 元自动续费",
    summary:
      "开通页面用「首月 1 元」吸引勾选连续包月，次月起按原价自动扣费且扣费前无提醒。处理步骤：进入 App 会员中心关闭自动续费；当月已被扣费的，先在 App 内申请退款，被拒后通过 12315 平台投诉，一般 7 个工作日内受理。",
    category: "subscription_trap",
    source: "中国消费者协会官网·消费维权报告",
    sourceUrl: "https://www.cca.org.cn/",
    legalBasis: "《网络交易监督管理办法》第 18 条：自动续费前 5 日需以显著方式提醒消费者",
    benefitTags: [],
  },
  {
    id: "st-002",
    title: "网盘免费试用 7 天，到期默认转连续包月",
    summary:
      "网盘类服务以「免费试用」为入口，开通时默认勾选「试用结束自动续费」，用户事后才在账单里发现扣费。关闭入口：微信「我 → 服务 → 钱包 → 支付设置 → 扣费服务」或支付宝「设置 → 支付设置 → 免密支付/自动扣款」，逐项检查后关闭不再使用的签约。",
    category: "subscription_trap",
    source: "微信支付官方文档·扣费服务管理",
    sourceUrl: "https://kf.qq.com/",
    legalBasis: "《消费者权益保护法实施条例》第 10 条（2024-07-01 施行）：自动展期、自动续费应在服务前和展期前以显著方式提请注意",
    benefitTags: [],
  },
  {
    id: "st-003",
    title: "音乐与阅读 App 联合会员：取消入口藏在三级菜单",
    summary:
      "音乐/阅读类 App 常把自动续费开关放在「我的 → 设置 → 账号与安全 → 订阅管理」等三级页面，用户找不到入口只能任其扣费。通用做法：在 App 内搜索「自动续费」直达管理页；若取消后仍被扣费，保留取消成功截图与扣费记录，向 12315 投诉。",
    category: "subscription_trap",
    source: "黑猫投诉平台·自动续费类投诉公示",
    sourceUrl: "https://tousu.sina.com.cn/",
    legalBasis: "《网络交易监督管理办法》第 18 条（扣费前 5 日显著提醒义务）",
    benefitTags: [],
  },
  {
    id: "st-004",
    title: "误点连续包年：一次扣 258 元还能退吗",
    summary:
      "开通会员时连续包年与连续包月入口相邻，误点包年一次扣走全年费用。处理步骤：24 小时内联系平台客服要求取消包年、退回差额（多数平台对未使用部分支持退款）；客服拒绝时整理开通页截图与扣费记录，向 12315 平台提交投诉。",
    category: "subscription_trap",
    source: "全国 12315 平台",
    sourceUrl: "https://www.12315.cn/",
    legalBasis: "《消费者权益保护法》第 8 条：消费者享有知悉其购买、使用的商品或者接受的服务的真实情况的权利",
    benefitTags: [],
  },

  // —— 预付风险 prepaid_risk ×3 ——
  {
    id: "pr-001",
    title: "健身房年卡 3999 元，开业三个月就关门",
    summary:
      "预付式消费最大风险是商家跑路：一次性支付大额年卡费用，商家停业后余额难以追回。维权步骤：保留合同、付款凭证与停业证据；向属地市场监管部门投诉；同店消费者可联合申请将商家列入经营异常名录，并追偿未消费余额。",
    category: "prepaid_risk",
    source: "全国 12315 平台",
    sourceUrl: "https://www.12315.cn/",
    legalBasis: "《消费者权益保护法》第 53 条：以预收款方式提供商品或服务未按约定提供的，应当退回预付款",
    benefitTags: [],
  },
  {
    id: "pr-002",
    title: "美容美发充值 8000 元，退卡却只退 60%",
    summary:
      "商家以「充 3000 送 1000」诱导大额充值，退卡时按原价扣减已消费部分甚至拒绝退款。依据预付卡限额：单张记名卡不得超过 5000 元，超额充值本身违规；退卡争议先要求商家出示扣费明细，协商不成向 12315 投诉。",
    category: "prepaid_risk",
    source: "商务部·《单用途商业预付卡管理办法（试行）》（商务部令 2012 年第 9 号）",
    sourceUrl: "https://www.mofcom.gov.cn/",
    legalBasis: "《单用途商业预付卡管理办法（试行）》第 18 条：单张记名卡限额 5000 元，不记名卡限额 1000 元",
    benefitTags: [],
  },
  {
    id: "pr-003",
    title: "培训机构预收两年学费，停课后拒不退款",
    summary:
      "培训机构以「多报多省」预收长期学费，中途停课后以合同为由拒绝退款。维权要点：预付合同未履行部分必须退还；签订前先查机构资质与预收费监管账户（校外培训预收费已纳入监管），缴费后保留合同与缴费凭证。",
    category: "prepaid_risk",
    source: "全国 12315 平台",
    sourceUrl: "https://www.12315.cn/",
    legalBasis: "《消费者权益保护法实施条例》第 22 条：收取预付款后未按约定提供商品或服务的，应按消费者要求退还预付款",
    benefitTags: [],
  },

  // —— 冲动消费 minor_spending ×2 ——
  {
    id: "ms-001",
    title: "未成年人游戏充值 2 万元：家长申请退款全流程",
    summary:
      "8 周岁以上未成年人未经监护人同意的大额游戏充值，监护人可以主张交易无效并要求退款。步骤：通过游戏官方「未成年人充值退款」通道（腾讯成长守护平台、网易家长关爱平台等）提交监护人身份证明与充值记录；平台拒绝时向 12315 投诉或起诉。",
    category: "minor_spending",
    source: "腾讯成长守护平台（未成年人充值退款通道）",
    sourceUrl: "https://jiazhang.qq.com/",
    legalBasis: "《民法典》第 19 条：限制民事行为能力人实施的与其年龄、智力不相适应的民事法律行为，须经法定代理人同意或追认",
    benefitTags: [],
  },
  {
    id: "ms-002",
    title: "未成年人直播打赏 5 万：最高法明确可要求退还",
    summary:
      "未成年人在直播间的大额打赏属于效力待定行为，监护人拒绝追认后应全额退还。维权路径：保留打赏记录与账号使用证据；联系平台提交未成年人消费争议材料；平台不处理时向法院起诉平台与主播。",
    category: "minor_spending",
    source: "最高人民法院官网",
    sourceUrl: "https://www.court.gov.cn/",
    legalBasis: "最高人民法院《关于依法妥善审理涉新冠肺炎疫情民事案件若干问题的指导意见（二）》第 9 条：与年龄、智力不相适应的打赏，监护人请求返还款项的，人民法院应予支持",
    benefitTags: [],
  },

  // —— 消费维权 consumer_rights ×4 ——
  {
    id: "cr-001",
    title: "网购 7 天无理由退货：规则与例外一次说清",
    summary:
      "通过网络、电视、电话、邮购等方式购买的商品，自收到之日起 7 日内可无理由退货（无需说明理由）。例外：定制商品、鲜活易腐商品、已下载的数字化商品、报纸期刊等。步骤：订单页发起退货 → 商家 48 小时内处理 → 超时平台客服介入。",
    category: "consumer_rights",
    source: "全国 12315 平台",
    sourceUrl: "https://www.12315.cn/",
    legalBasis: "《消费者权益保护法》第 25 条（七日无理由退货制度）",
    benefitTags: [],
  },
  {
    id: "cr-002",
    title: "12315 投诉全流程：从平台客服到市场监管",
    summary:
      "纠纷处理顺序：平台官方客服 → 不满意或 7 日未解决 → 12315。投诉材料：订单号、付款凭证、沟通记录、诉求金额。通过「全国 12315 平台」网站或小程序提交，市场监管部门一般 7 个工作日内决定是否受理，受理后 45 个工作日内办结。",
    category: "consumer_rights",
    source: "全国 12315 平台",
    sourceUrl: "https://www.12315.cn/",
    legalBasis: "《市场监督管理投诉举报处理暂行办法》（市场监管总局令第 20 号）",
    benefitTags: [],
  },
  {
    id: "cr-003",
    title: "虚假宣传：承诺与实物不符可主张退一赔三",
    summary:
      "商家宣传与实物明显不符（材质、产地、功能等）构成欺诈，可主张退还货款并按价款 3 倍赔偿，赔偿不足 500 元的按 500 元计。固定证据：商品页截图、开箱视频、与客服的沟通记录，证据越完整成功率越高。",
    category: "consumer_rights",
    source: "中国消费者协会官网·消费维权指引",
    sourceUrl: "https://www.cca.org.cn/",
    legalBasis: "《消费者权益保护法》第 55 条（欺诈行为退一赔三，最低 500 元）",
    benefitTags: [],
  },
  {
    id: "cr-004",
    title: "买到过期食品：10 倍赔偿怎么主张",
    summary:
      "买到过期或变质食品，可要求退还价款并主张价款 10 倍或损失 3 倍的赔偿金，最低 1000 元。步骤：保留小票并给商品拍照 → 与商家协商 → 协商不成向 12315 投诉或起诉。关键在于证据完整（购物凭证 + 商品实物 + 生产日期特写）。",
    category: "consumer_rights",
    source: "全国 12315 平台",
    sourceUrl: "https://www.12315.cn/",
    legalBasis: "《食品安全法》第 148 条（惩罚性赔偿）",
    benefitTags: [],
  },

  // —— 平台规则 platform_rule ×3 ——
  {
    id: "pl-001",
    title: "iOS 订阅管理：删除 App 不等于退订",
    summary:
      "iPhone 上删除 App 不会取消订阅，扣费会一直继续。取消路径：设置 → 点击顶部 Apple ID → 订阅 → 选择服务 → 取消订阅；扣费日 24 小时前取消才不产生下期费用。已扣费用可通过 reportaproblem.apple.com 向 Apple 申请退款。",
    category: "platform_rule",
    source: "Apple 支持官方文档·「取消、更改或暂停订阅」",
    sourceUrl: "https://support.apple.com/zh-cn/HT202039",
    benefitTags: [],
  },
  {
    id: "pl-002",
    title: "微信支付扣费服务：一键查清所有自动扣款",
    summary:
      "微信「我 → 服务 → 钱包 → 支付设置 → 扣费服务」列出所有签约的自动扣款项目，可逐项查看扣费记录并关闭。账单导出：钱包 → 账单 → 常见问题 → 下载账单，可用于个人对账或维权举证。",
    category: "platform_rule",
    source: "微信支付官方帮助中心",
    sourceUrl: "https://kf.qq.com/",
    benefitTags: [],
  },
  {
    id: "pl-003",
    title: "支付宝自动扣款管理与带章账单导出",
    summary:
      "支付宝「我的 → 设置 → 支付设置 → 免密支付/自动扣款」可管理所有签约扣款服务；「我的 → 账单 → 开具交易流水证明」可导出带官方盖章的流水，凭证效力高于截图，适合投诉与诉讼举证。",
    category: "platform_rule",
    source: "支付宝服务大厅",
    sourceUrl: "https://cshall.alipay.com/",
    benefitTags: [],
  },

  // —— 法律法规 regulation ×2 ——
  {
    id: "rg-001",
    title: "《消费者权益保护法实施条例》第 10 条：自动续费必须显著提示",
    summary:
      "2024 年 7 月 1 日起施行的实施条例第 10 条明确：经营者采取自动展期、自动续费等方式提供服务的，应当在消费者接受服务前和自动展期、自动续费等日期前，以显著方式提请消费者注意。平台未提示即扣费，可据此主张退款。",
    category: "regulation",
    source: "中国政府网·政策文件库",
    sourceUrl: "https://www.gov.cn/",
    legalBasis: "《中华人民共和国消费者权益保护法实施条例》第 10 条",
    benefitTags: [],
  },
  {
    id: "rg-002",
    title: "《网络交易监督管理办法》第 18 条：扣费前 5 日提醒",
    summary:
      "网络交易经营者采取自动展期、自动续费等方式的，应当在服务到期前 5 日，以显著方式提请消费者注意，由消费者自主选择是否续费。扣费前未收到任何提醒的，属于违反该条的违规扣费，可向市场监管部门反映。",
    category: "regulation",
    source: "国家市场监督管理总局官网",
    sourceUrl: "https://www.samr.gov.cn/",
    legalBasis: "《网络交易监督管理办法》第 18 条",
    benefitTags: [],
  },

  // —— 省钱建议 spending_advice ×3 ——
  {
    id: "sa-001",
    title: "拿铁因子：每天 15 元的年化成本",
    summary:
      "每天一杯 15 元咖啡，一年约 5,475 元。小额高频支出因单笔金额小最容易被忽视。做法：先完整记账一个月，把「每天必买的小额消费」单独列一行，再逐项决定保留、降频还是替代（自带、平替等）。",
    category: "spending_advice",
    source: "中国消费者协会官网·消费教育栏目",
    sourceUrl: "https://www.cca.org.cn/",
    benefitTags: [],
  },
  {
    id: "sa-002",
    title: "50/30/20 法则：把预算拆成三个口袋",
    summary:
      "每月收入按 50% 必要支出、30% 弹性支出、20% 储蓄/还款分配。学生收入结构不同，可调整为 60/30/10，核心是先有分配框架再花钱，而不是月底看剩多少。预算中心的分月视图可以直接套用这个框架。",
    category: "spending_advice",
    source: "人民网·财经频道",
    sourceUrl: "https://finance.people.com.cn/",
    benefitTags: [],
  },
  {
    id: "sa-003",
    title: "大促防冲动：购物车冷静 24 小时",
    summary:
      "促销氛围下的「限时立减」最容易触发冲动下单。三条规则：加购物车 24 小时后再结算；下单前核对历史价格判断是否真降价；单笔超过月生活费 5% 的消费强制延后 3 天。中消协历年双 11 消费提示均强调先列清单再消费。",
    category: "spending_advice",
    source: "中国消费者协会官网·双 11 消费提示",
    sourceUrl: "https://www.cca.org.cn/",
    benefitTags: [],
  },

  // —— 学生权益 student_benefits ×3 ——
  {
    id: "sb-001",
    title: "学生认证外卖优惠：每月固定省下一笔",
    summary:
      "美团、饿了么等外卖平台提供学生认证通道（App 内「学生专区」），认证后获得专属券包与会员折扣，通常比普通用户省 20%-40%。认证需要学籍信息，毕业自动失效。",
    category: "student_benefits",
    source: "美团 App「学生专区」公开规则",
    sourceUrl: "https://www.meituan.com/",
    benefitTags: ["student_cert"],
  },
  {
    id: "sb-002",
    title: "Apple 教育优惠：Mac/iPad 教育折扣与返校季",
    summary:
      "高校在校生、录取新生与教职员工可在 Apple 教育商店以教育折扣购买 Mac、iPad 及配件，返校季（7-9 月）通常加赠配件或优惠券。下单需通过 UNiDAYS 或学信网完成身份验证。",
    category: "student_benefits",
    source: "Apple 教育商店（中国大陆）",
    sourceUrl: "https://www.apple.com.cn/cn-edu/shop",
    benefitTags: ["edu_discount", "student_cert"],
  },
  {
    id: "sb-003",
    title: "校园资源替代付费订阅：图书馆电子资源",
    summary:
      "多数高校图书馆已购买知网、万方、正版软件与数据库的校园授权，凭校园网或 VPN 免费使用；视频、音乐会员可先查学校是否有教育版合作。优先用校园资源替代个人订阅，每年可省数百元。",
    category: "student_benefits",
    source: "CALIS 中国高等教育文献保障系统",
    sourceUrl: "https://www.calis.edu.cn/",
    benefitTags: ["campus_card", "budget_substitute"],
  },
];
