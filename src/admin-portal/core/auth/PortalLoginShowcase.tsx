'use client'

import React, { useState } from 'react'
import { IconBuildingSkyscraper, IconCheck, IconFlame, IconRobot } from '@tabler/icons-react'

import { PortalLoginForm } from './PortalLoginForm'

interface PortalLoginShowcaseProps {
  returnTo: string
  fetcher?: typeof fetch
}

export function PortalLoginShowcase({ returnTo, fetcher }: PortalLoginShowcaseProps) {
  // State for Pipeline Sandbox interaction
  const [pipelineScenario, setPipelineScenario] = useState<number>(0)
  const [pipelineActiveStep, setPipelineActiveStep] = useState<number>(1)

  const scenarios = [
    {
      country: '🇸🇦 沙特阿拉伯 (利雅得)',
      client: '示例买家 A',
      rawMsg:
        '“Urgent inquiry: Looking for 6063-T5 anodized architectural aluminum profiles for a 24-story facade project in Riyadh. Need 50 tons, ASTM E84 Class A certification required.”',
      specs: ['6063-T5 阳极氧化铝', '50 吨', 'ASTM E84 防火 A 级', '预计货期 25 天'],
      score: 98,
      scoreLevel: 'A 级 (大额工程意向)',
      feishuStatus: '演示：将线索同步到飞书协同队列，等待销售跟进',
    },
    {
      country: '🇩🇪 德国 (汉堡)',
      client: '示例买家 B',
      rawMsg:
        '“Wir suchen hochwertige thermisch getrennte Aluminium-Profilsysteme für ein Wohnprojekt. Budget ca. 180.000 EUR. Bitte um technisches Datenblatt.”',
      specs: ['三玻两腔断桥铝系统', '预算 €180,000', 'EN 13830 欧标', '索取技术规格书'],
      score: 94,
      scoreLevel: 'A 级 (高意向分销采购)',
      feishuStatus: '演示：生成德语技术规格书与报价草案，待人工确认',
    },
    {
      country: '🇺🇸 美国 (洛杉矶)',
      client: '示例买家 C',
      rawMsg:
        '“Hello, we are remodeling a commercial office complex and need flame-retardant decorative acoustic aluminum panels. Requesting samples & CIF Los Angeles quote.”',
      specs: ['阻燃吸音装饰铝板', '样品册寄送', 'CIF 美西港口', '商业工装定制'],
      score: 89,
      scoreLevel: 'B+ 级 (样品与询盘阶段)',
      feishuStatus: '演示：创建美洲销售跟进与样品寄送待办',
    },
  ]

  return (
    <div className="login-showcase-page theme-studio-b3">
      <div className="login-showcase-container">
        {/* =========================================================================
            LEFT COLUMN: PRODUCT CAPABILITIES & PIPELINE SANDBOX
           ========================================================================= */}
        <section className="showcase-left-pane">
          {/* Brand Header with New Ivybm Logo */}
          <div className="brand-header-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="Ivybm AI 获客运营中台"
              className="brand-logo-img"
              height={38}
              src="/brand/ivybm-logo-trimmed.png"
              width={118}
            />
            <span className="brand-badge-divider" />
            <span className="brand-system-tag">
              <IconBuildingSkyscraper size={15} />
              <span>全球建材 AI 获客与全媒体运营智能中枢</span>
            </span>
          </div>

          <h1 className="hero-heading">
            让 AI 成为外贸出海获客与 <br />
            <span className="hero-heading-gradient">全媒体矩阵运营的数字中枢</span>
          </h1>
          <p className="hero-desc">
            全渠道线索处理与入库 · AI 客服智能接待与人工接管 · 社媒内容支持受控发布 ·
            飞书多维表协同。
          </p>

          {/* Pipeline Sandbox Interactive Board */}
          <div className="showcase-board">
            <div className="board-header">
              <div className="board-dots">
                <span className="board-dot red" />
                <span className="board-dot yellow" />
                <span className="board-dot green" />
              </div>
              <div className="board-title-tag">
                <span className="live-pulse" />
                <span>IVYBM LEAD ACQUISITION PIPELINE SANDBOX · 演示数据</span>
              </div>
              <div style={{ fontSize: 11, color: '#3130C0', fontWeight: 700 }}>
                点击案例查看演示流转 ➔
              </div>
            </div>

            <div className="board-content">
              <p className="showcase-disclaimer">
                以下案例均为虚构演示数据，不代表真实客户、生产结果或平台已上线能力。
              </p>

              {/* 4 Pipeline Step Nodes */}
              <div className="pipeline-steps-bar">
                <button
                  className={`pipeline-step-item ${pipelineActiveStep === 1 ? 'is-active' : ''}`}
                  onClick={() => setPipelineActiveStep(1)}
                  aria-pressed={pipelineActiveStep === 1}
                  type="button"
                >
                  <span className="pipeline-step-num">STEP 01</span>
                  <span className="pipeline-step-title">全球询盘实时捕获</span>
                </button>
                <button
                  className={`pipeline-step-item ${pipelineActiveStep === 2 ? 'is-active' : ''}`}
                  onClick={() => setPipelineActiveStep(2)}
                  aria-pressed={pipelineActiveStep === 2}
                  type="button"
                >
                  <span className="pipeline-step-num">STEP 02</span>
                  <span className="pipeline-step-title">AI 需求清洗与打分</span>
                </button>
                <button
                  className={`pipeline-step-item ${pipelineActiveStep === 3 ? 'is-active' : ''}`}
                  onClick={() => setPipelineActiveStep(3)}
                  aria-pressed={pipelineActiveStep === 3}
                  type="button"
                >
                  <span className="pipeline-step-num">STEP 03</span>
                  <span className="pipeline-step-title">知识库参数智能匹配</span>
                </button>
                <button
                  className={`pipeline-step-item ${pipelineActiveStep === 4 ? 'is-active' : ''}`}
                  onClick={() => setPipelineActiveStep(4)}
                  aria-pressed={pipelineActiveStep === 4}
                  type="button"
                >
                  <span className="pipeline-step-num">STEP 04</span>
                  <span className="pipeline-step-title">飞书/销售协同闭环</span>
                </button>
              </div>

              {/* Scenario Switcher Pills */}
              <div className="scenario-pill-group">
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#475569',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  买家案例演练:
                </span>
                {scenarios.map((sc, idx) => (
                  <button
                    key={idx}
                    className={`scenario-pill-btn ${pipelineScenario === idx ? 'is-active' : ''}`}
                    onClick={() => setPipelineScenario(idx)}
                    aria-pressed={pipelineScenario === idx}
                    type="button"
                  >
                    {sc.country}
                  </button>
                ))}
              </div>

              {/* Sandbox Stage 3-Panel Matrix */}
              <div className="sandbox-stage-grid">
                {/* Panel 1: Raw Inquiry */}
                <div className="sandbox-panel">
                  <div>
                    <div className="sandbox-panel-head">
                      <IconFlame size={13} style={{ color: '#D97706' }} />
                      <span>买家原始接入 ({scenarios[pipelineScenario].client})</span>
                    </div>
                    <div className="sandbox-panel-main" style={{ fontStyle: 'italic' }}>
                      {scenarios[pipelineScenario].rawMsg}
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: '#64748B', marginTop: 6 }}>
                    演示来源: 海外官网 ChatWidget · 模拟耗时 0.2s
                  </div>
                </div>

                {/* Panel 2: AI Structured Extraction */}
                <div className="sandbox-panel">
                  <div>
                    <div className="sandbox-panel-head">
                      <IconRobot size={13} style={{ color: '#3130C0' }} />
                      <span>AI 智能解析规格与资质</span>
                    </div>
                    <div className="sandbox-tag-list">
                      {scenarios[pipelineScenario].specs.map((spec, i) => (
                        <span key={i} className="sandbox-chip">
                          ✓ {spec}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: '#15803D', fontWeight: 700, marginTop: 8 }}>
                    ● 意向评级: {scenarios[pipelineScenario].scoreLevel} (
                    {scenarios[pipelineScenario].score}分)
                  </div>
                </div>

                {/* Panel 3: Lark/Feishu Sync */}
                <div
                  className="sandbox-panel"
                  style={{ background: '#F0FDF4', borderColor: '#BBF7D0' }}
                >
                  <div>
                    <div className="sandbox-panel-head" style={{ color: '#15803D' }}>
                      <IconCheck size={13} />
                      <span>飞书协同与跟进闭环</span>
                    </div>
                    <div className="sandbox-panel-main" style={{ fontSize: 11, color: '#166534' }}>
                      {scenarios[pipelineScenario].feishuStatus}
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: '#15803D', fontWeight: 700, marginTop: 6 }}>
                    演示状态 · 实际结果以受控环境为准
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* =========================================================================
            RIGHT COLUMN: REFINED LOGIN CARD (Cleaned up form)
           ========================================================================= */}
        <aside className="showcase-right-pane">
          <div className="login-card">
            <h2 className="login-card-title">欢迎登录 IVYBM</h2>
            <p className="login-card-desc">登录全球建材 AI 获客中台，开启出海提效之旅。</p>

            {/* Embedded Cleaned Portal Login Form */}
            <PortalLoginForm fetcher={fetcher} returnTo={returnTo} />
          </div>
        </aside>
      </div>

      {/* Clean Footer without ICP placeholder */}
      <footer className="showcase-footer">
        <span>© 2026 IVYBM · 受邀账号登录</span>
      </footer>
    </div>
  )
}
