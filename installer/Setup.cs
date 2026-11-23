using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace WordEquationTools
{
    internal static class Setup
    {
        private const string ProgId = "WordEquationTools.Connect";
        private const string Clsid = "{846B61EB-DF9D-4E60-BDB9-4D57AF1B4E18}";
        private const string ClassName = "WordEquationTools.Connect";
        private const string ComClass = @"Software\Classes\CLSID\" + Clsid;
        private const string ComProgram = @"Software\Classes\" + ProgId;
        private const string WordRegistration = @"Software\Microsoft\Office\Word\Addins\" + ProgId;
        private const string WordAppPath = @"Software\Microsoft\Windows\CurrentVersion\App Paths\Winword.exe";

        [STAThread]
        private static int Main(string[] args)
        {
            bool silent = args.Length == 1 && (args[0] == "--install" || args[0] == "--uninstall");
            if (args.Length > 0 && !silent) return 2;
            bool remove = silent && args[0] == "--uninstall";
            Application.EnableVisualStyles();
            try
            {
                if (!silent)
                {
                    DialogResult action = ChooseAction();
                    if (action == DialogResult.Cancel) return 0;
                    remove = action == DialogResult.No;
                }
                using (var mutex = new Mutex(false, @"Local\WordEquationToolsSetup"))
                {
                    bool locked;
                    try { locked = mutex.WaitOne(5000); }
                    catch (AbandonedMutexException) { locked = true; }
                    if (!locked) throw new InvalidOperationException("另一个安装程序正在运行。");
                    try
                    {
                        string library = remove ? null : InstallFile();
                        foreach (var view in Views())
                        {
                            using (var registry = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, view))
                            {
                                if (remove) Unregister(registry);
                                else Register(registry, library);
                            }
                        }
                    }
                    finally { mutex.ReleaseMutex(); }
                }
                if (!silent)
                    MessageBox.Show(remove ? "已卸载当前 Windows 账户的插件。请重新打开 Word。" :
                        "已安装到当前 Windows 账户。" + Environment.NewLine + DescribeWord() + Environment.NewLine +
                        "保存并退出所有 Word 窗口，再打开 Word，顶部会显示「公式排版」。",
                        "Word 公式排版插件", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return 0;
            }
            catch (Exception error)
            {
                if (!silent)
                    MessageBox.Show("设置未完成。\n" + error.Message, "Word 公式排版插件",
                        MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 1;
            }
        }

        private static RegistryView[] Views()
        {
            return Environment.Is64BitOperatingSystem
                ? new[] { RegistryView.Registry64, RegistryView.Registry32 }
                : new[] { RegistryView.Registry32 };
        }

        private static DialogResult ChooseAction()
        {
            using (var form = new Form())
            using (var font = new Font("Microsoft YaHei UI", 10F))
            {
                form.Text = "Word 公式排版插件";
                form.Font = font;
                form.StartPosition = FormStartPosition.CenterScreen;
                form.AutoScaleMode = AutoScaleMode.Font;
                form.FormBorderStyle = FormBorderStyle.FixedDialog;
                form.MinimizeBox = false;
                form.MaximizeBox = false;
                form.AutoSize = true;
                form.AutoSizeMode = AutoSizeMode.GrowAndShrink;
                var rows = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.TopDown,
                    WrapContents = false, Padding = new Padding(16) };
                rows.Controls.Add(new Label { AutoSize = true, Text = DescribeWord() + Environment.NewLine +
                    "请使用日常打开 Word 的 Windows 账户安装。", Margin = new Padding(3, 4, 3, 14) });
                var buttons = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = Padding.Empty };
                var install = new Button { Text = "安装", AutoSize = true, DialogResult = DialogResult.Yes };
                var remove = new Button { Text = "卸载", AutoSize = true, DialogResult = DialogResult.No };
                var diagnose = new Button { Text = "安装状态", AutoSize = true };
                var close = new Button { Text = "关闭", AutoSize = true, DialogResult = DialogResult.Cancel };
                diagnose.Click += (sender, args) => MessageBox.Show(form, InstallationStatus(), "安装状态",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
                buttons.Controls.AddRange(new Control[] { install, remove, diagnose, close });
                rows.Controls.Add(buttons);
                form.Controls.Add(rows);
                form.AcceptButton = install;
                form.CancelButton = close;
                return form.ShowDialog();
            }
        }

        private static string DescribeWord()
        {
            foreach (var hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
                foreach (var view in Views())
                    using (var root = RegistryKey.OpenBaseKey(hive, view))
                    using (var key = root.OpenSubKey(WordAppPath))
                    {
                        string path = key == null ? null : key.GetValue("") as string;
                        string bitness = ReadWordBitness(path);
                        if (bitness != null) return "检测到桌面版 Word（" + bitness + "）。";
                    }
            foreach (var view in Views())
                using (var root = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view))
                using (var key = root.OpenSubKey(@"Software\Microsoft\Office\ClickToRun\Configuration"))
                {
                    string platform = key == null ? null : key.GetValue("Platform") as string;
                    if (platform == "x86" || platform == "x64")
                        return "Office 安装记录显示为 " + (platform == "x86" ? "32 位" : "64 位") + "。";
                }
            return "未能自动识别桌面版 Word。可在 Word 的「文件 → 账户 → 关于 Word」确认。";
        }

        private static string ReadWordBitness(string path)
        {
            if (String.IsNullOrWhiteSpace(path)) return null;
            path = path.Trim().Trim('"');
            if (!File.Exists(path)) return null;
            try
            {
                using (var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (var binary = new BinaryReader(file))
                {
                    if (file.Length < 64 || binary.ReadUInt16() != 0x5a4d) return null;
                    file.Position = 0x3c;
                    int peHeader = binary.ReadInt32();
                    if (peHeader < 64 || peHeader > file.Length - 6) return null;
                    file.Position = peHeader;
                    if (binary.ReadUInt32() != 0x00004550) return null;
                    switch (binary.ReadUInt16())
                    {
                        case 0x014c: return "32 位";
                        case 0x8664: return "64 位";
                        case 0xaa64: return "ARM64";
                        default: return null;
                    }
                }
            }
            catch (IOException) { return null; }
            catch (UnauthorizedAccessException) { return null; }
        }

        private static string InstallationStatus()
        {
            var text = new StringBuilder(DescribeWord()).AppendLine();
            foreach (var view in Views())
                using (var root = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, view))
                using (var addin = root.OpenSubKey(WordRegistration))
                using (var server = root.OpenSubKey(ComClass + @"\InprocServer32"))
                {
                    string codebase = server == null ? null : server.GetValue("CodeBase") as string;
                    Uri uri;
                    bool installed = Uri.TryCreate(codebase, UriKind.Absolute, out uri) && uri.IsFile && File.Exists(uri.LocalPath);
                    text.Append(view == RegistryView.Registry32 ? "32 位：" : "64 位：");
                    if (addin == null || !installed) text.AppendLine("当前账户的安装记录不完整，请点「安装」。");
                    else if (Object.Equals(addin.GetValue("LoadBehavior"), 3)) text.AppendLine("注册完整，已设为启动时加载。");
                    else text.AppendLine("已注册。请在 Word 的「文件 → 选项 → 加载项」查看是否停用。");
                }
            text.Append("Word 的实际加载结果可在「文件 → 选项 → 加载项」查看。");
            return text.ToString();
        }

        private static string InstallFile()
        {
            byte[] bytes;
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("AddIn"))
            using (var buffer = new MemoryStream())
            {
                if (stream == null) throw new InvalidDataException("安装包缺少插件。");
                stream.CopyTo(buffer);
                bytes = buffer.ToArray();
            }
            string fingerprint;
            using (var hash = SHA256.Create()) fingerprint = BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "");
            string folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "WordEquationTools", fingerprint);
            Directory.CreateDirectory(folder);
            string library = Path.Combine(folder, "WordEquationTools.dll");
            if (!File.Exists(library))
            {
                var temp = Path.Combine(folder, Guid.NewGuid().ToString("N") + ".tmp");
                try
                {
                    File.WriteAllBytes(temp, bytes);
                    File.Move(temp, library);
                }
                finally { if (File.Exists(temp)) File.Delete(temp); }
            }
            string actual;
            using (var hash = SHA256.Create())
            using (var input = File.OpenRead(library)) actual = BitConverter.ToString(hash.ComputeHash(input)).Replace("-", "");
            if (!String.Equals(actual, fingerprint, StringComparison.Ordinal)) throw new InvalidDataException("本机插件文件与安装包不一致。");
            return library;
        }

        private static void Register(RegistryKey root, string library)
        {
            var assembly = AssemblyName.GetAssemblyName(library);
            if (!String.Equals(assembly.Name, "WordEquationTools", StringComparison.Ordinal))
                throw new InvalidDataException("插件标识不匹配。");
            using (var key = root.CreateSubKey(ComClass)) key.SetValue("", ClassName);
            using (var key = root.CreateSubKey(ComClass + @"\ProgId")) key.SetValue("", ProgId);
            using (var key = root.CreateSubKey(ComProgram + @"\CLSID")) key.SetValue("", Clsid);
            using (var key = root.CreateSubKey(ComClass + @"\InprocServer32"))
            {
                key.SetValue("", "mscoree.dll");
                key.SetValue("ThreadingModel", "Both");
                SetAssembly(key, assembly, library);
                using (var version = key.CreateSubKey(assembly.Version.ToString())) SetAssembly(version, assembly, library);
            }
            using (var key = root.CreateSubKey(WordRegistration))
            {
                key.SetValue("FriendlyName", "公式排版");
                key.SetValue("Description", "在 Word 中插入 LaTeX 公式并更新编号");
                key.SetValue("LoadBehavior", 3, RegistryValueKind.DWord);
            }
        }

        private static void SetAssembly(RegistryKey key, AssemblyName assembly, string library)
        {
            key.SetValue("Class", ClassName);
            key.SetValue("Assembly", assembly.FullName);
            key.SetValue("RuntimeVersion", "v4.0.30319");
            key.SetValue("CodeBase", new Uri(library).AbsoluteUri);
        }

        private static void Unregister(RegistryKey root)
        {
            root.DeleteSubKeyTree(WordRegistration, false);
            root.DeleteSubKeyTree(ComClass, false);
            root.DeleteSubKeyTree(ComProgram, false);
        }
    }
}
