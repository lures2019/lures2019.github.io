<div align="center">
  <h1>Word 公式排版插件</h1>
  <p>在 Windows 桌面 Word 中插入可编辑的公式，自动居中、右侧编号。</p>
  <p><code>Word 原生公式</code> · <code>MathType 7</code> · <code>单双栏排版</code></p>
  <p>
    <a href="#使用指南">使用指南</a> ·
    <a href="#下载">下载</a> ·
    <a href="#开发思路">开发思路</a>
  </p>
</div>

![新版公式编辑界面，左侧为多行 LaTeX 编辑区，右侧为字号、栏数和编号设置。](docs/images/formula-dialog.png)

## 使用指南

### 安装并插入第一条公式

1. 保存文档并退出所有 Word 窗口。用平时打开 Word 的 Windows 账户运行[安装程序](#下载)，点 **安装**。
2. 重开 Word，把光标放在正文的空白段落，点击 **公式排版 → 插入公式**。
3. 选择 **Word 原生公式**，粘贴示例，按 **Ctrl + Enter** 或点 **插入公式**。新文档的第一条公式默认编号为 `(1)`。

~~~latex
\frac{a_1 + a_2}{2} + \sqrt{x_i^2 + y_i^2}
~~~

安装器会为 Windows 上的 **32 位和 64 位桌面 Word** 注册加载项。当前版本已在 64 位 Word 2021 中验证过插入和编号，也做过 32 位 COM 加载检查。

### 选编辑器、字号和栏数

| 模式 | 怎么输入 | 字号怎么设 |
| --- | --- | --- |
| **Word 原生公式** | 在多行编辑区输入 LaTeX。工具栏可插入分式、根号、上标和下标，也可在编辑区空白时点 **填入示例**。 | 在 **公式字号（磅）** 中设置，支持 6 到 72 磅，可按 0.5 磅调整。 |
| **MathType 7** | 点 **打开 MathType**，在本机 MathType 编辑器中输入，完成后关闭编辑器回到 Word。此模式需要已启用 Word 加载项的可用 MathType 7 桌面版。 | 勾选 **保留 MathType 字号** 时，在 MathType 的 **大小 → 定义** 中设置。取消勾选后，插件按指定字号等比调整公式在 Word 中的显示。 |

同一窗口内切换模式时，已输入的 LaTeX 会保留。点 **适应屏幕** 可展开窗口，再点 **还原窗口** 恢复。窄窗口的排版设置位于编辑区下方，可滚动查看。

| 栏数选项 | 什么时候选 |
| --- | --- |
| **跟随位置** | 日常排版。公式在光标所在的正文栏居中，编号贴该栏右边。 |
| **单栏 · 通栏** | 双栏论文中有一条公式需要横跨两栏。 |
| **双栏 · 当前栏** | 希望公式按双栏排版，并在自己的栏内居中。 |

所选栏数与当前位置不同时，插件可在公式处插入连续分节符。要沿用模板的分栏，选 **跟随位置**。

### 设定编号

在 **编号格式**中保留一个 `{n}` 作为序号。**起始编号**留空会续编，填写数字会从当前条重新计数。

| 编号格式 | 起始编号 | 当前条显示 |
| --- | --- | --- |
| `({n})` | 留空，文档第一条 | `(1)` |
| `(A-{n})` | `5` | `(A-5)` |
| `（3-{n}）` | `1` | `（3-1）` |

通过插件插入的 Word 公式和 MathType 公式共用一套编号。插入公式或保存文档时会刷新编号。移动公式时，把公式所在段落和编号一起移动。需要立即重排时，点 **公式排版 → 更新公式编号**。

### 常见问题

- **装好后看不到「公式排版」**。在安装器中打开 **安装状态**，再到 Word 的 **文件 → 选项 → 加载项** 检查 COM 加载项。安装程序目前未签名。单位电脑若限制未签名的加载项，请把 Word 的提示交给管理员确认。 [Microsoft 加载项管理说明](https://support.microsoft.com/en-us/office/add-ins/view-manage-and-install-add-ins-for-excel-powerpoint-and-word)
- **MathType 无法打开**。在 Word 的 **MathType → 内联** 里试插公式，确认桌面版 MathType 的授权和加载项状态。
- **公式太长或插入位置有误**。公式和编号放不进一栏时，可减小字号、选择通栏，或用 `aligned` 写成多行公式。插入点应在可编辑正文的独立段落。
- **需要卸载**。运行安装程序，点 **卸载**，再重开 Word。已插入的公式及编号域由 Word 保存在文档中。

## 下载

| 文件 | 用途 |
| --- | --- |
| **[Windows 安装程序（EXE）][installer-download]** | 直接安装或转发给同事。一个 EXE 已包含加载项。 |
| **[源码压缩包（ZIP）][source-download]** | 查看 C# 源码、PowerShell 构建脚本和测试。 |

[installer-download]: ./WordEquationSetup.exe
[source-download]: ./WordEquationTools-source.zip

## 开发思路

写论文时，公式本身通常只需输入一次，反复花时间的是对齐、切换栏数和重新编号。插件把这些操作放进 Word 的同一个窗口，让作者先写公式，再按光标位置的栏宽完成排版。

- **保留公式的可编辑性。** Word 模式把受支持的 LaTeX 转成可继续编辑的 OMML 公式。MathType 模式调用本机编辑器，保留可编辑的 MathType OLE 对象。
- **按正文栏宽对齐。** 公式和编号分别使用居中、右对齐的位置制表符。切换分栏时，排版范围由 Word 的节管理。
- **按文档顺序统一编号。** 两种公式都使用 `SEQ WordEquationToolsNumber` 域。插入或移除公式后，可以按文档顺序重排同一套编号。
- **优先保证公式输入空间。** 宽窗口让编辑区和设置并排。窄窗口将设置放到下方，保留底部的插入操作。

### 源码结构与本地构建

| 源码 | 职责 |
| --- | --- |
| [`src/AddIn.cs`](src/AddIn.cs) | Word 功能区入口，处理保存与编号刷新事件 |
| [`src/EquationDialog.cs`](src/EquationDialog.cs) | WinForms 编辑窗口、模板按钮和响应式布局 |
| [`src/Latex.cs`](src/Latex.cs) | 本地 LaTeX 解析及 MathML → OMML 转换 |
| [`src/Equation.cs`](src/Equation.cs) | Word 与 MathType 公式插入、分栏、对齐和编号 |
| [`installer/Setup.cs`](installer/Setup.cs) | 为当前 Windows 账户安装、诊断和卸载 COM 加载项 |
| [`tests/Program.cs`](tests/Program.cs) | 输入、界面、Word 集成与混合编号测试 |

在 Windows 上准备 PowerShell、.NET Framework C# 编译器和 Office 互操作程序集。编译器及程序集的具体路径见 [`build.ps1`](build.ps1)。在项目根目录执行以下命令。

~~~powershell
.\build.ps1
.\build\WordEquationTests.exe
.\build\WordEquationTests.exe --ui .\build\qa-layout
.\build\WordEquationTests.exe .\build\qa-word
~~~

构建生成 `build/WordEquationSetup.exe`、`build/WordEquationTools.dll` 和测试运行器。执行真实 Word 测试需要桌面版 Word。安装当前构建并启用 MathType Word 加载项后，可以用 `.\build\WordEquationTests.exe .\build\qa-mixed --installed --mathtype` 检查混排和保存时更新编号。混排测试使用随源码提供的 MathType 对象。

当前源码目录未附带许可证文件。
