import * as vscode from 'vscode';
import { Minimatch } from 'minimatch';

type Config = {
  maxLines: number;
  languagesAllowlist: string[];
  pathAllowlist: string[];
  showInfoMessage: boolean;
};

let bypassOnce = false;

export function activate(context: vscode.ExtensionContext) {
  const getConfig = (): Config => {
    const cfg = vscode.workspace.getConfiguration('lineLimitBlocker');
    return {
      maxLines: cfg.get('maxLines', 1000),
      languagesAllowlist: cfg.get('languagesAllowlist', []),
      pathAllowlist: cfg.get('pathAllowlist', []),
      showInfoMessage: cfg.get('showInfoMessage', true)
    };
  };

  const getAllowMatchers = () => getConfig().pathAllowlist.map(p => new Minimatch(p));

  async function checkAndClose(doc: vscode.TextDocument) {
    if (bypassOnce) { bypassOnce = false; return; }
    if (doc.isUntitled) return;

    const cfg = getConfig();
    const filePath = doc.uri.fsPath || doc.uri.path;

    // パス許可リスト
    for (const mm of getAllowMatchers()) {
      if (mm.match(filePath)) return;
    }

    // 言語許可リスト
    if (cfg.languagesAllowlist.includes(doc.languageId)) return;

    // 行数チェック
    if (doc.lineCount <= cfg.maxLines) return;

    // タブを閉じる
    for (const group of vscode.window.tabGroups.all) {
      const tab = group.tabs.find(t => t.input && isSameDoc(t.input, doc));
      if (tab) {
        await vscode.window.tabGroups.close(tab, true);
        if (cfg.showInfoMessage) {
          vscode.window.showWarningMessage(
            `LineLimitBlocker: '${basename(filePath)}' は ${doc.lineCount} 行あり、上限 (${cfg.maxLines}) を超えています。`,
            '次の1回だけ許可'
          ).then(async (action) => {
            if (action) {
              bypassOnce = true;
              await vscode.window.showTextDocument(doc, { preview: true });
            }
          });
        }
        return;
      }
    }
  }

  // 既に開いているファイルをチェック
  vscode.workspace.textDocuments.forEach(checkAndClose);

  // 新しく開かれたドキュメントを監視
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(checkAndClose));

  // 次回1回だけ許可するコマンド
  context.subscriptions.push(vscode.commands.registerCommand('lineLimitBlocker.openAnywayOnce', () => {
    bypassOnce = true;
    vscode.window.showInformationMessage('LineLimitBlocker: 次の1回だけ開くことを許可します。');
  }));
}

function isSameDoc(input: any, doc: vscode.TextDocument) {
  const uri = input?.uri ?? input?.resource;
  return uri?.toString() === doc.uri.toString();
}

function basename(p: string) {
  return p.replace(/\\/g, '/').split('/').pop() ?? p;
}

export function deactivate() {}