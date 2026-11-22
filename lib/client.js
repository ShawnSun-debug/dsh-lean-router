// dsh-lean-router - 客户端 UI 层（技能面板）
//
// 加载契约（逆向自 dsh-cost-meter / dsh-ops 的产物，dsh 客户端模块系统 dsh-client-modules）：
//   1. 入口文件是 lib/client.js，package.json 用 dsh.client.platform = "web" 声明；
//   2. 文件形如 window.__ModuleLoader__.load({ id, factory })，factory(require) 内
//      require 宿主提供的模块（react / react-dom / @deepseek-ai/dsh-client-ui-*），
//      插件自身的依赖不打包，全部走宿主；
//   3. factory 返回插件模块，导出 apply（cordis 插件形；generator 形式 = effect 生命周期）。
//
// 阶段 1（骨架）：顶栏工具区一个「技能」按钮，点开全屏门户面板，面板内容暂为占位；
// 面板与按钮同组件、用 ReactDOM.createPortal 挂到 body，不依赖第二个 slot，
// 也不受任何 slot 容器的布局/裁剪影响。
//
// 阶段 2：接宿主数据（31 技能 + 审计统计）；阶段 3：分组表 + 开关 + 一键工作流。
window.__ModuleLoader__.load({
  id: "dsh-lean-router",
  factory: (require) => {
    const React = require("react");
    const ReactDOM = require("react-dom");
    const h = React.createElement;

    const btnStyle = {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      height: 26,
      padding: "0 10px",
      marginLeft: 6,
      borderRadius: 6,
      border: "1px solid var(--dsh-border, rgba(128,128,128,.35))",
      background: "var(--dsh-surface, transparent)",
      color: "inherit",
      fontSize: 12,
      lineHeight: "24px",
      cursor: "pointer",
    };

    const overlayStyle = {
      position: "fixed",
      inset: 0,
      zIndex: 1000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,.45)",
    };

    const cardStyle = {
      position: "relative",
      width: "min(920px, 92vw)",
      maxHeight: "82vh",
      overflow: "auto",
      padding: "20px 22px",
      borderRadius: 12,
      background: "var(--dsh-surface, #1b1b1f)",
      color: "var(--dsh-text, inherit)",
      boxShadow: "0 18px 60px rgba(0,0,0,.45)",
      fontSize: 13,
      lineHeight: 1.6,
    };

    const closeStyle = {
      position: "absolute",
      top: 10,
      right: 12,
      border: "none",
      background: "transparent",
      color: "inherit",
      fontSize: 18,
      lineHeight: "20px",
      cursor: "pointer",
      opacity: 0.7,
    };

    /** 技能面板（阶段 1 占位；阶段 2/3 接真实数据）。 */
    function SkillsPanel(props) {
      return h(
        "div",
        { style: overlayStyle, onClick: props.onClose },
        h(
          "div",
          { style: cardStyle, onClick: (event) => event.stopPropagation() },
          h("button", { type: "button", style: closeStyle, onClick: props.onClose, title: "关闭" }, "✕"),
          h("div", { style: { fontSize: 15, fontWeight: 600, marginBottom: 8 } }, "技能面板 · 骨架"),
          h(
            "div",
            { style: { opacity: 0.75 } },
            "链路已通：这个面板由 dsh-lean-router 的客户端插件渲染。",
            h("br"),
            "阶段 2 接入 31 个技能与审计统计，阶段 3 加分组表格、开关与一键工作流。"
          )
        )
      );
    }

    /** 顶栏「技能」按钮：点开/关闭门户面板。 */
    function SkillsButton() {
      const [open, setOpen] = React.useState(false);
      const close = React.useCallback(() => setOpen(false), []);
      return h(
        React.Fragment,
        null,
        h(
          "button",
          {
            type: "button",
            style: btnStyle,
            title: "lean-router 技能面板",
            onClick: () => setOpen((value) => !value),
          },
          "技能"
        ),
        open ? ReactDOM.createPortal(h(SkillsPanel, { onClose: close }), document.body) : null
      );
    }

    /** cordis 插件入口：注册顶栏按钮（generator = effect，卸载时自动注销）。 */
    function* apply(ctx) {
      yield ctx.slots.register(
        { name: "conversation.session.header.utilities", id: "lean-router.skills", order: 60 },
        SkillsButton
      );
    }

    return { apply };
  },
});
