# AI 客服双语知识、Prompt 与验收包

状态：待甲方业务审核，不得直接标记为 `reviewed` 或导入 production。

适用范围：官网 ChatWidget、Facebook Messenger、Instagram DM 共用的英文 / 阿语知识问答、2–3 轮初筛、人工接管、Lead 与飞书验收。

## 1. 本批资料采用范围

本批只复用仓库中标注为“来自客户确认旧站”的公开内容，包含：

- 公司名称与 CNC 加工、IQC / IPQC / FQC / OQC / QA-CA 质量控制能力；
- 双曲、单曲和实心铝板的定义、典型应用、工程与样品流程、检验和包装边界；
- 加拿大双曲项目、香港屯门铜色双曲项目、顺德体育馆曲面铝板项目的公开案例事实；
- 阳极氧化、粉末 / 液体涂层的通用选择与项目确认边界；
- 询价前建议收集的图纸 / 3D 模型、数量、材料、表面处理、项目地点、支撑与接缝、包装和目标日期。

明确排除：

- `seed/knowledgeDemo.ts` 的 synthetic demo 数据；
- 旧站首页中标注为 development content 的摘要；
- 旧 IVY 厚度对照表中的具体“名义 / 实际”数值，除非甲方重新确认适用标准；
- 价格、折扣、MOQ、交期、库存、产能、运费、付款条款、认证适用性、保证性能、质保、赔偿和合同承诺。

## 2. 导入与审核方式

本包生成两份 DOCX：

1. `IVYBM-Customer-Chat-Knowledge-EN.docx`：英文正式来源候选，可作为 Knowledge Source 上传；
2. `IVYBM-Customer-Chat-Knowledge-AR-Review-Reference.docx`：阿语人工校对参考，不建议作为第二个独立 Source 重复上传。

推荐流程：

1. 甲方审核两份 DOCX 的事实、术语和对外权限；
2. 上传英文 DOCX，`originalLanguage=en`，填写来源标题、类型和版本；
3. worker 自动生成英文 / 阿语两份 `draft`；
4. 英文草稿与英文来源逐条核对，阿语草稿与阿语参考逐条核对；
5. 确认无商业承诺后，将两种语言分别设为 `reviewed` 和 `customerVisible=true`；
6. 提交索引，等待两份文档均为 `indexStatus=ready`；
7. 再启用 active `customer-chat` Prompt 并执行第 5 节验收。

不得上传英文、阿语两个来源后让系统生成两组重复翻译文档。若业务决定分别维护两个来源，必须使用不同的明确版本和主题范围，并在索引前去重。

## 3. Customer Chat Prompt v1 候选

Collection 字段建议：

- `key`: `ivybm.customer-chat`
- `purpose`: `customer-chat`
- `locale`: `all`
- `version`: `1`
- `status`: 先保存为 `draft`；完成知识审核后再激活
- `model`: 留空，由 AI route 决定

Prompt 正文：

```text
Reply concisely in the customer's language. Use only the reviewed, customer-visible knowledge supplied in the context and cite the relevant source. Answer the customer's current question first, then ask no more than two relevant missing project details. Do not repeat information already provided.

Never invent specifications, capabilities, project facts, or commercial commitments. For price, discount, MOQ, delivery, stock, capacity, freight, payment terms, certification or compliance, warranty or claims, contract or legal terms, complaints, or any fact not supported by reviewed knowledge, do not provide a substantive commitment; request human handoff.

Do not claim that a quotation, order, message, publication, notification, or handoff succeeded unless the system confirms it.
```

说明：追问字段顺序、每轮最多两个问题、最多三轮，以及 A/B/C 评分和接管状态由服务端确定，不交给 Prompt 自由决定。Prompt 的 `variables` 当前不做运行时插值，不应依赖变量占位符。

## 4. 产品事实与风险边界

### 4.1 可直接回答的范围

- 双曲铝板：两个主方向均有曲率，通常按数字模型、批准图纸、样品、接口和检验要求定制；可用于机场、车站、体育馆、博物馆、雨棚和异形室内造型。
- 单曲铝板：在一个主方向按项目半径成形；常用于曲面柱、屋面 / 雨棚带、吊顶、弧形幕墙区域。
- 实心铝板：可按批准图纸形成平板、折板、曲面、冲孔或特殊造型模块；可结合折边、加强筋、角码、支架或盒式接口。
- 表面处理：阳极氧化、粉末或液体涂层等需结合合金、成形、暴露环境、项目规范和批准样品选择；颜色、光泽、纹理、批次范围和验收方式应在生产前确认。
- 质量与包装：可按项目约定执行来料、过程、成品、出货检查，以及编号、防护、标签、装箱单和出口包装协调。

### 4.2 必须转人工的范围

以下问题可以收集需求和联系方式，但不得给出确定答案：

- 单价、总价、折扣、MOQ；
- 库存、产能、生产周期、发货 / 到货日期；
- 运费、港口、Incoterms、付款比例或账期；
- 项目是否必然满足某认证、法规、荷载、防火或性能要求；
- 质保范围、索赔、投诉责任、赔偿；
- 合同或法律条款；
- 未出现在 reviewed knowledge 中的事实。

## 5. 真实验收场景

### 5.1 英文高意向，两轮完成

访客第 1 轮：

```text
We need double-curved aluminum facade panels for a project.
```

期望：AI 仅依据已审核知识简要回答，并最多追问国家 / 市场和公司。

访客第 2 轮：

```text
Company: Acme Facades. The project is a UAE tender for about 1,200 sqm, procurement is planned within 3 months, drawings are ready, and our work email is buyer@example.com.
```

期望：识别明确项目、国家、公司、投标阶段、数量、采购时间、图纸和联系方式；达到 A 级后立即 `handoff_requested`，创建 / 更新一个 Lead，并进入飞书 `new_lead` / 高意向链路。不得因为预算等非关键字段缺失继续机械追问。

### 5.2 阿语高意向，两轮完成

访客第 1 轮：

```text
نحن شركة النور في السعودية والمشروع مناقصة لألواح واجهات ألمنيوم منحنية.
```

期望：使用阿语回答，识别公司、国家和项目阶段，最多追问数量和采购时间。

访客第 2 轮：

```text
نحتاج نحو 1200 متر مربع، ولدينا رسومات وخطة شراء خلال 3 أشهر. البريد الإلكتروني للعمل هو buyer@example.com.
```

期望：达到 A 级，进入人工接管，Lead 中保留阿语原文、结构化信号和渠道来源，并只产生一次飞书同步 / 通知。

### 5.3 高风险立即转人工

英文：

```text
Can you guarantee the final price, fire certification and delivery within 20 days?
```

阿语：

```text
هل تضمنون السعر النهائي وشهادة الحريق والتسليم خلال 20 يوماً؟
```

期望：第一轮即 `handoff_requested`，reason=`high_risk_topic`；不得输出保证、估价或交期数字。进入 `human_active` 后，后续访客消息不再触发 AI 自动回复。

### 5.4 三轮仍不完整

访客连续给出模糊回答且未形成 A 级，服务端每轮最多追问两个未问字段；第三轮后仍缺关键信息时转人工，reason=`qualification_incomplete`。不得开启第四轮自动初筛。

### 5.5 幂等与渠道身份

- 官网需要工作邮箱作为可持续联系渠道，电话可补充；
- Facebook Messenger / Instagram DM 的已验签平台身份可作为可持续联系渠道，不伪造邮箱；
- 同一 Webhook / 外部消息重复投递时，不重复创建 Message、Lead、飞书同步或通知；
- AI 或人工出站只有在 provider 返回确定结果后才记录已发送；不确定结果使用 `delivery_unknown`，停止自动重发。

## 6. 验收证据清单

每个英文 / 阿语场景保留：

- 会话 ID、渠道、平台账号、外部发送者 ID（日志与截图中脱敏）；
- 每轮访客消息、AI / 人工回复、引用知识标题与版本；
- Prompt key / version、AI model、handoff reason；
- Lead ID、A/B/C 级别、评分理由和结构化字段；
- 飞书同步 Job / provider key 和最终状态；
- 重放同一外部事件后的幂等结果；
- provider 失败或结果未知时的页面状态与不重发证据。

## 7. 甲方只需确认的内容

- 公司名称、三类产品描述、加工 / 质量能力是否仍可公开；
- 三个案例名称、地点和描述是否允许用于客服回答；
- 英文 / 阿语产品术语是否准确；
- 表面处理和包装描述是否仍有效；
- 哪位业务人员负责知识审核；
- Prompt 的语气和强制转人工范围是否认可。

确认前，本包和生成 DOCX 只能作为候选资料；确认后才可进入 `reviewed → index ready → active Prompt → production acceptance`。
