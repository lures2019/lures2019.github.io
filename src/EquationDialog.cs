using System;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using Word = Microsoft.Office.Interop.Word;

namespace WordEquationTools
{
    internal sealed class EquationDialog : Form
    {
        private static readonly Color Canvas = SystemInformation.HighContrast ? SystemColors.Window : Color.FromArgb(242, 246, 251);
        private static readonly Color Paper = SystemColors.Window;
        private static readonly Color Ink = SystemInformation.HighContrast ? SystemColors.WindowText : Color.FromArgb(22, 35, 58);
        private static readonly Color Muted = SystemInformation.HighContrast ? SystemColors.WindowText : Color.FromArgb(70, 88, 112);
        private static readonly Color Accent = SystemInformation.HighContrast ? SystemColors.Highlight : Color.FromArgb(34, 78, 164);
        private static readonly Color Border = SystemInformation.HighContrast ? SystemColors.WindowText : Color.FromArgb(204, 216, 232);
        private static readonly Color EditorSurface = SystemInformation.HighContrast ? SystemColors.Window : Color.FromArgb(248, 250, 254);
        private static readonly Color ErrorColor = SystemInformation.HighContrast ? SystemColors.WindowText : Color.FromArgb(160, 38, 64);

        private readonly Word.Application word;
        private readonly Word.Document doc;
        private readonly Word.Range location;
        private readonly int currentColumns;
        private readonly TextBox input, format, restart;
        private readonly NumericUpDown size;
        private readonly ComboBox mode;
        private readonly RadioButton wordMode, mathTypeMode;
        private readonly CheckBox preserve;
        private readonly Label editorTitle, mathTypeHelp, numberingHint, sizeHint, layoutHint, status;
        private readonly Panel viewport, body, editorCard, settingsCard, editorFrame, mathTypePanel;
        private readonly FlowLayoutPanel snippets;
        private readonly TableLayoutPanel settings;
        private readonly Button example, insert, fit;
        private IWin32Window owner;
        private bool reflowing;

        internal decimal LastSize { get { return size.Value; } }
        internal Editor LastEditor { get { return mathTypeMode.Checked ? Editor.MathType : Editor.Word; } }
        internal string LastPattern { get { return format.Text; } }
        internal EquationOptions PendingMathType { get; private set; }
        private Layout SelectedLayout { get { return (Layout)mode.SelectedIndex; } }

        internal EquationDialog(Word.Application word, Word.Document doc, Word.Range location, decimal lastSize,
            Editor lastEditor, string lastPattern, int currentColumns)
        {
            this.word = word;
            this.doc = doc;
            this.location = location;
            this.currentColumns = currentColumns;
            Text = "公式排版";
            Font = new Font("Microsoft YaHei UI", 10F);
            AutoScaleDimensions = new SizeF(96, 96);
            AutoScaleMode = AutoScaleMode.Dpi;
            StartPosition = FormStartPosition.Manual;
            ClientSize = new Size(980, 638);
            FormBorderStyle = FormBorderStyle.Sizable;
            MinimizeBox = false;
            ShowInTaskbar = false;
            ShowIcon = false;
            BackColor = Canvas;
            ForeColor = Ink;

            var root = Table(1);
            root.Padding = new Padding(24, 17, 24, 14);
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            Controls.Add(root);

            wordMode = EngineChoice("WordMode", "Word 原生公式");
            mathTypeMode = EngineChoice("MathTypeMode", "MathType 7");
            wordMode.Checked = lastEditor == Editor.Word;
            mathTypeMode.Checked = lastEditor == Editor.MathType;
            fit = ActionButton("FitScreen", "适应屏幕", false, 98);
            fit.Click += (sender, args) => ToggleFitScreen();
            root.Controls.Add(BuildHeader(), 0, 0);

            viewport = new Panel { Name = "FormulaWorkspace", Dock = DockStyle.Fill, AutoScroll = true, Margin = Padding.Empty };
            body = new Panel { Name = "WorkspaceContent" };
            viewport.Controls.Add(body);
            root.Controls.Add(viewport, 0, 1);

            editorCard = Card("EditorCard", Paper, new Padding(17, 13, 17, 16));
            settingsCard = Card("SettingsCard", Paper, new Padding(16, 13, 16, 13));
            body.Controls.Add(editorCard);
            body.Controls.Add(settingsCard);
            editorTitle = TextLabel("LaTeX 公式", 13.5F, FontStyle.Bold, Ink);
            snippets = new FlowLayoutPanel { Name = "LatexSnippets", Dock = DockStyle.Fill, AutoSize = true, WrapContents = true,
                Margin = new Padding(0, 6, 0, 8) };
            snippets.Controls.Add(Snippet("分式", @"\frac{", "a", "}{b}", 2));
            snippets.Controls.Add(Snippet("根号", @"\sqrt{", "x", "}", -1));
            snippets.Controls.Add(Snippet("上标", "^{", "2", "}", -1));
            snippets.Controls.Add(Snippet("下标", "_{", "i", "}", -1));
            example = ActionButton("LatexExample", "填入示例", false, 76);
            example.Click += (sender, args) =>
            {
                if (!String.IsNullOrWhiteSpace(input.Text)) return;
                input.Text = @"\frac{a}{b} + \sqrt{x} = x_i^2";
                input.SelectAll();
                input.Focus();
            };
            snippets.Controls.Add(example);
            input = new TextBox { Name = "Latex", AccessibleName = "LaTeX 公式", Multiline = true, AcceptsReturn = true,
                ScrollBars = ScrollBars.Vertical, WordWrap = true, Dock = DockStyle.Fill, MaxLength = 4096,
                Font = new Font("Consolas", 15F), BorderStyle = BorderStyle.None, BackColor = EditorSurface, ForeColor = Ink };
            input.TextChanged += (sender, args) =>
            {
                example.Enabled = String.IsNullOrWhiteSpace(input.Text);
                ResetStatus();
            };
            editorFrame = Card("LatexEditorFrame", EditorSurface, new Padding(11, 11, 8, 9));
            editorFrame.Dock = DockStyle.Fill;
            editorFrame.Controls.Add(input);

            mathTypePanel = Card("MathTypePanel", EditorSurface, new Padding(16));
            mathTypePanel.Dock = DockStyle.Fill;
            var mathIntro = Table(1);
            mathIntro.Controls.Add(TextLabel("在 MathType 中输入", 15F, FontStyle.Bold, Ink), 0, 0);
            mathTypeHelp = TextLabel("点击「打开 MathType」。编辑完成后关闭编辑器，公式就会回到 Word。", 10.5F, FontStyle.Regular, Muted);
            mathIntro.Controls.Add(mathTypeHelp, 0, 1);
            mathTypePanel.Controls.Add(mathIntro);
            editorCard.Controls.Add(BuildEditor());

            size = new NumericUpDown { Name = "EquationFontSize", AccessibleName = "公式字号（磅）", Minimum = 6, Maximum = 72,
                DecimalPlaces = 1, Increment = 0.5M, Value = lastSize, Dock = DockStyle.Fill, Margin = new Padding(0, 2, 0, 2) };
            mode = new ComboBox { Name = "ColumnMode", AccessibleName = "栏数", DropDownStyle = ComboBoxStyle.DropDownList,
                Dock = DockStyle.Fill, Margin = new Padding(0, 2, 0, 2) };
            mode.Items.AddRange(new object[] { "跟随位置（" + currentColumns + " 栏）", "单栏 · 通栏", "双栏 · 当前栏" });
            mode.SelectedIndex = 0;
            format = new TextBox { Name = "NumberFormat", AccessibleName = "编号格式", Text = lastPattern, MaxLength = 36,
                Dock = DockStyle.Fill, Margin = new Padding(0, 2, 0, 2) };
            restart = new TextBox { Name = "NumberRestart", AccessibleName = "起始编号", MaxLength = 6, Dock = DockStyle.Fill,
                Margin = new Padding(0, 2, 0, 2) };
            preserve = new CheckBox { Name = "PreserveMathTypeSize", Text = "保留 MathType 字号", AutoSize = true, Checked = true,
                ForeColor = Ink, Margin = new Padding(0, 13, 0, 0) };
            numberingHint = TextLabel("{n} 表示序号。起始编号留空则续编。", 9F, FontStyle.Regular, Muted);
            numberingHint.Margin = new Padding(0, 9, 0, 0);
            sizeHint = TextLabel("", 9F, FontStyle.Regular, Muted);
            sizeHint.Margin = new Padding(0, 3, 0, 0);
            layoutHint = TextLabel("", 9F, FontStyle.Regular, Muted);
            layoutHint.Margin = new Padding(0, 8, 0, 0);
            settings = BuildSettings();
            settingsCard.Controls.Add(settings);

            status = new Label { Name = "InputStatus", AccessibleName = "输入提示", AutoSize = true, Anchor = AnchorStyles.Left,
                ForeColor = Muted, Margin = new Padding(0, 1, 10, 0) };
            insert = ActionButton("InsertFormula", "插入公式", true, 113);
            insert.Click += (sender, args) => Insert();
            var cancel = ActionButton("CancelFormula", "取消", false, 75);
            cancel.DialogResult = DialogResult.Cancel;
            root.Controls.Add(BuildFooter(cancel), 0, 2);
            CancelButton = cancel;
            AcceptButton = insert;

            wordMode.CheckedChanged += (sender, args) => { if (wordMode.Checked) UpdateEditor(); };
            mathTypeMode.CheckedChanged += (sender, args) => { if (mathTypeMode.Checked) UpdateEditor(); };
            preserve.CheckedChanged += (sender, args) => UpdateEditor();
            mode.SelectedIndexChanged += (sender, args) => UpdateLayoutHint();
            viewport.SizeChanged += (sender, args) => Reflow();
            Resize += (sender, args) => fit.Text = WindowState == FormWindowState.Maximized ? "还原窗口" : "适应屏幕";
            Shown += (sender, args) =>
            {
                if (LastEditor == Editor.Word) input.Focus();
                else insert.Focus();
            };
            UpdateEditor();
            UpdateLayoutHint();
        }

        internal DialogResult ShowFor(IWin32Window parent)
        {
            owner = parent;
            if (owner != null && owner.Handle != IntPtr.Zero) Location = Screen.FromHandle(owner.Handle).WorkingArea.Location;
            return ShowDialog(parent);
        }

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            Rectangle area = owner == null || owner.Handle == IntPtr.Zero
                ? Screen.FromControl(this).WorkingArea : Screen.FromHandle(owner.Handle).WorkingArea;
            Size minimum = SizeFromClientSize(new Size(Scaled(440), Scaled(372)));
            Size preferred = SizeFromClientSize(new Size(Scaled(980), Scaled(638)));
            Size available = new Size(Math.Max(1, area.Width - Scaled(16)), Math.Max(1, area.Height - Scaled(16)));
            MinimumSize = new Size(Math.Min(minimum.Width, available.Width), Math.Min(minimum.Height, available.Height));
            Bounds = CenteredBounds(area, new Size(Math.Min(preferred.Width, available.Width), Math.Min(preferred.Height, available.Height)));
            Reflow();
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (keyData == (Keys.Control | Keys.Enter))
            {
                Insert();
                return true;
            }
            return base.ProcessCmdKey(ref msg, keyData);
        }

        private void ToggleFitScreen()
        {
            WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
        }

        private int Scaled(int value) { return (int)Math.Round(value * CurrentAutoScaleDimensions.Width / 96F); }

        private static Rectangle CenteredBounds(Rectangle area, Size size)
        {
            return new Rectangle(area.Left + (area.Width - size.Width) / 2, area.Top + (area.Height - size.Height) / 2,
                size.Width, size.Height);
        }

        private void Reflow()
        {
            if (reflowing || viewport.Width <= 0 || viewport.Height <= 0) return;
            reflowing = true;
            try
            {
                int gap = Scaled(14);
                int scroll = SystemInformation.VerticalScrollBarWidth;
                int available = Math.Max(1, viewport.Width);
                bool sideBySide = available - scroll >= Scaled(710);
                int settingsWidth = sideBySide ? Math.Min(Scaled(334), Math.Max(Scaled(276), available / 3)) : available;
                int settingsHeight = MeasureSettings(settingsWidth);
                int minimumEditor = Scaled(242);
                int minimumBody = sideBySide ? Math.Max(minimumEditor, settingsHeight) : minimumEditor + gap + settingsHeight;
                if (minimumBody > viewport.Height)
                {
                    available = Math.Max(1, available - scroll);
                    if (!sideBySide)
                    {
                        settingsWidth = available;
                        settingsHeight = MeasureSettings(settingsWidth);
                        minimumBody = minimumEditor + gap + settingsHeight;
                    }
                }
                int height = Math.Max(viewport.Height, minimumBody);
                int editorWidth = sideBySide ? Math.Max(1, available - settingsWidth - gap) : available;
                int editorHeight = sideBySide ? height : height - settingsHeight - gap;
                body.Size = new Size(available, height);
                editorCard.SetBounds(0, 0, editorWidth, editorHeight);
                settingsCard.SetBounds(sideBySide ? editorWidth + gap : 0, sideBySide ? 0 : editorHeight + gap,
                    settingsWidth, settingsHeight);
                mathTypeHelp.MaximumSize = new Size(Math.Max(1, editorWidth - Scaled(72)), 0);
                viewport.AutoScrollMinSize = new Size(0, minimumBody);
                viewport.PerformLayout();
            }
            finally { reflowing = false; }
        }

        private int MeasureSettings(int width)
        {
            int inside = Math.Max(1, width - settingsCard.Padding.Horizontal);
            numberingHint.MaximumSize = new Size(inside, 0);
            sizeHint.MaximumSize = new Size(inside, 0);
            layoutHint.MaximumSize = new Size(inside, 0);
            return settings.GetPreferredSize(new Size(inside, 0)).Height + settingsCard.Padding.Vertical + Scaled(2);
        }

        private void UpdateEditor()
        {
            bool mathType = LastEditor == Editor.MathType;
            input.Visible = !mathType;
            editorFrame.Visible = !mathType;
            mathTypePanel.Visible = mathType;
            snippets.Visible = !mathType;
            preserve.Visible = mathType;
            sizeHint.Visible = mathType;
            sizeHint.Text = preserve.Checked ? "在 MathType 的「大小 → 定义」中设字号。" : "按指定字号等比缩放 Word 中的公式。";
            size.Enabled = !mathType || !preserve.Checked;
            editorTitle.Text = mathType ? "MathType 公式" : "LaTeX 公式";
            insert.Text = mathType ? "打开 MathType" : "插入公式";
            StyleChoice(wordMode);
            StyleChoice(mathTypeMode);
            ResetStatus();
            Reflow();
        }

        private void UpdateLayoutHint()
        {
            layoutHint.Text = mode.SelectedIndex > 0 && mode.SelectedIndex != currentColumns
                ? "将为公式所在区域切换栏数。" : "";
            layoutHint.Visible = layoutHint.Text.Length > 0;
            Reflow();
        }

        private void ResetStatus()
        {
            if (status == null) return;
            status.ForeColor = Muted;
            status.Text = LastEditor == Editor.MathType ? "Ctrl + Enter 打开 MathType" : "Ctrl + Enter 插入公式";
        }

        private void Insert()
        {
            ResetStatus();
            try
            {
                var options = new EquationOptions(input.Text, size.Value, SelectedLayout, format.Text, restart.Text.Trim(),
                    LastEditor, preserve.Checked);
                if (LastEditor == Editor.MathType)
                {
                    MathTypeEditor.EnsureAvailable(word);
                    PendingMathType = options;
                    DialogResult = DialogResult.OK;
                    return;
                }
                var result = Equation.Insert(word, doc, location, options);
                var end = Math.Min(result.End - 1, doc.Content.End - 1);
                doc.Range(end, end).Select();
                DialogResult = DialogResult.OK;
            }
            catch (InputException error) { ShowError(error.Message); }
            catch (Exception error)
            {
                Trace.WriteLine("WordEquationTools: insert failed, HRESULT " + error.HResult);
                ShowError("未能插入公式。请确认文档可编辑，并检查公式后重试。");
            }
        }

        private void ShowError(string message)
        {
            status.ForeColor = ErrorColor;
            status.Text = message;
        }

        private TableLayoutPanel BuildHeader()
        {
            var header = Table(2);
            header.Margin = new Padding(0, 0, 0, 13);
            header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            header.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            header.Controls.Add(TextLabel("插入带编号公式", 22F, FontStyle.Bold, Ink), 0, 0);
            fit.Anchor = AnchorStyles.Right;
            header.Controls.Add(fit, 1, 0);
            var engines = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 7, 0, 0) };
            engines.Controls.Add(wordMode);
            engines.Controls.Add(mathTypeMode);
            header.Controls.Add(engines, 0, 1);
            header.SetColumnSpan(engines, 2);
            return header;
        }

        private TableLayoutPanel BuildEditor()
        {
            var panel = Table(1);
            panel.AutoSize = false;
            panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            panel.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            panel.Controls.Add(editorTitle, 0, 0);
            panel.Controls.Add(snippets, 0, 1);
            var content = new Panel { Dock = DockStyle.Fill, Margin = new Padding(0, 3, 0, 0) };
            content.Controls.Add(editorFrame);
            content.Controls.Add(mathTypePanel);
            panel.Controls.Add(content, 0, 2);
            return panel;
        }

        private TableLayoutPanel BuildSettings()
        {
            var panel = Table(2);
            panel.Dock = DockStyle.Top;
            panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 44F));
            panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 56F));
            SettingsSpan(panel, TextLabel("排版设置", 13.5F, FontStyle.Bold, Ink), 0);
            panel.Controls.Add(Field("公式字号（磅）", size, true), 0, 1);
            panel.Controls.Add(Field("栏数", mode, false), 1, 1);
            panel.Controls.Add(Field("编号格式", format, true), 0, 2);
            panel.Controls.Add(Field("起始编号", restart, false), 1, 2);
            SettingsSpan(panel, numberingHint, 3);
            SettingsSpan(panel, preserve, 4);
            SettingsSpan(panel, sizeHint, 5);
            SettingsSpan(panel, layoutHint, 6);
            return panel;
        }

        private TableLayoutPanel BuildFooter(Button cancel)
        {
            var footer = Table(2);
            footer.Margin = new Padding(0, 12, 0, 0);
            footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            footer.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            footer.Controls.Add(status, 0, 0);
            var actions = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = Padding.Empty };
            actions.Controls.Add(cancel);
            actions.Controls.Add(insert);
            footer.Controls.Add(actions, 1, 0);
            footer.SizeChanged += (sender, args) =>
            {
                int width = Math.Max(Scaled(75), footer.Width - actions.GetPreferredSize(Size.Empty).Width - status.Margin.Horizontal);
                if (status.MaximumSize.Width != width) status.MaximumSize = new Size(width, 0);
            };
            return footer;
        }

        private Button Snippet(string label, string opening, string placeholder, string closing, int nextField)
        {
            var button = ActionButton("Latex" + label, label, false, 54);
            button.Click += (sender, args) =>
            {
                int start = input.SelectionStart;
                string selected = input.SelectedText;
                string value = selected.Length == 0 ? placeholder : selected;
                string expression = opening + value + closing;
                if (input.TextLength - input.SelectionLength + expression.Length > input.MaxLength)
                {
                    ShowError("公式已达到输入长度上限。");
                    return;
                }
                input.SelectedText = expression;
                if (selected.Length == 0) input.Select(start + opening.Length, placeholder.Length);
                else if (nextField >= 0) input.Select(start + opening.Length + value.Length + nextField, 1);
                input.Focus();
            };
            return button;
        }

        private static TableLayoutPanel Field(string label, Control control, bool left)
        {
            var panel = Table(1);
            panel.Margin = new Padding(0, 11, left ? 12 : 0, 0);
            panel.Controls.Add(TextLabel(label, 9.5F, FontStyle.Regular, Ink), 0, 0);
            panel.Controls.Add(control, 0, 1);
            return panel;
        }

        private static void SettingsSpan(TableLayoutPanel panel, Control item, int row)
        {
            panel.Controls.Add(item, 0, row);
            panel.SetColumnSpan(item, 2);
        }

        private static Label TextLabel(string text, float points, FontStyle style, Color color)
        {
            return new Label { Text = text, AutoSize = true, ForeColor = color,
                Font = new Font("Microsoft YaHei UI", points, style), Margin = new Padding(0, 0, 0, 3) };
        }

        private static TableLayoutPanel Table(int columns)
        {
            return new TableLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink,
                ColumnCount = columns, Margin = Padding.Empty, GrowStyle = TableLayoutPanelGrowStyle.AddRows };
        }

        private static Panel Card(string name, Color color, Padding padding)
        {
            var panel = new Panel { Name = name, BackColor = color, Padding = padding };
            panel.Paint += (sender, args) =>
            {
                if (panel.Width > 0 && panel.Height > 0)
                    using (var pen = new Pen(Border)) args.Graphics.DrawRectangle(pen, 0, 0, panel.Width - 1, panel.Height - 1);
            };
            return panel;
        }

        private static Button ActionButton(string name, string text, bool primary, int width)
        {
            var button = new Button { Name = name, Text = text, MinimumSize = new Size(width, primary ? 37 : 34),
                AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, FlatStyle = FlatStyle.Flat, BackColor = primary ? Accent : Paper,
                ForeColor = primary ? (SystemInformation.HighContrast ? SystemColors.HighlightText : Color.White) : Ink,
                Margin = new Padding(0, 0, 6, 2), UseVisualStyleBackColor = false };
            button.FlatAppearance.BorderColor = primary ? Accent : Border;
            return button;
        }

        private static RadioButton EngineChoice(string name, string text)
        {
            return new RadioButton { Name = name, Text = text, Appearance = Appearance.Button, TextAlign = ContentAlignment.MiddleCenter,
                AutoSize = true, MinimumSize = new Size(124, 35), Margin = new Padding(0, 0, 8, 0),
                FlatStyle = FlatStyle.Flat, UseVisualStyleBackColor = false };
        }

        private static void StyleChoice(RadioButton button)
        {
            button.BackColor = button.Checked ? Accent : Paper;
            button.ForeColor = button.Checked
                ? (SystemInformation.HighContrast ? SystemColors.HighlightText : Color.White) : Ink;
            button.FlatAppearance.BorderColor = button.Checked ? Accent : Border;
            button.FlatAppearance.CheckedBackColor = Accent;
        }
    }
}
