const SEPARATOR = '[｜丨|]';
const HEADER_RE = new RegExp(`^\\s*wxchead\\s*${SEPARATOR}\\s*([^｜丨|\\r\\n]+?)\\s*${SEPARATOR}\\s*([^｜丨|\\r\\n]+?)\\s*$`, 'i');
const ANY_HEADER_RE = /^\s*(?:wxhead|wxghead|wxchead)\s*[｜丨|]/i;
const PRIVATE_HEADER_RE = /^(\s*)wxhead\s*[｜丨|]\s*([^｜丨|\r\n]+?)\s*$/i;
const WX_RE = new RegExp(`^(\\s*)wx\\s*${SEPARATOR}\\s*([^｜丨|\\r\\n]+?)\\s*${SEPARATOR}\\s*([^｜丨|\\r\\n]+?)\\s*${SEPARATOR}\\s*(.+?)(\\s*)$`, 'i');

const normalizeName = value => String(value || '')
    .trim()
    .replace(/^[「『“"'【\[]+|[」』”"'】\]]+$/g, '')
    .replace(/\s+/g, '')
    .toLocaleLowerCase();

function nameSet(...values) {
    return new Set(values.flat().map(normalizeName).filter(Boolean));
}

function isNamed(value, names) {
    return names.has(normalizeName(value));
}

function buildAliases({ userName = '', rightName = '', leftName = '' } = {}) {
    return {
        user: nameSet(userName, '{{user}}', '{user}', 'user', '用户'),
        right: nameSet(rightName),
        left: nameSet(leftName),
    };
}

function canonicalLine(kind, sender, body, indent = '', tail = '') {
    return `${indent}${kind}｜${String(sender).trim()}｜${String(body).trim()}${tail}`;
}

function resolveDirection(sender, recipient, context, aliases) {
    // A wxchead block should contain two non-user characters. If the header
    // itself names the user, it is not safe to infer a third-party direction.
    if (isNamed(context.right, aliases.user) || isNamed(context.left, aliases.user)) return '';
    const senderIsUser = isNamed(sender, aliases.user);
    const recipientIsUser = isNamed(recipient, aliases.user);
    const senderIsLeft = isNamed(sender, aliases.left);
    const recipientIsLeft = isNamed(recipient, aliases.left);

    if (senderIsUser && recipientIsLeft) return 'right';
    if (senderIsLeft && recipientIsUser) return 'left';
    return '';
}

function correctLine(line, context, options, lineNumber) {
    const aliases = buildAliases({ userName: options.userName, rightName: context.right, leftName: context.left });
    const wx = line.match(WX_RE);
    if (wx) {
        const [, indent, sender, recipient, body, tail] = wx;
        const direction = resolveDirection(sender, recipient, context, aliases);
        if (!direction) return null;
        const after = direction === 'right'
            ? canonicalLine('wxc', context.right, body, indent, tail)
            : canonicalLine('wxn', context.left, body, indent, tail);
        return {
            after,
            change: {
                line: lineNumber,
                reason: direction === 'right' ? '右侧人物被明确写成了 user' : '右侧收件人被明确写成了 user',
                before: line,
                after,
            },
        };
    }

    return null;
}

/**
 * Correct only identity/direction mistakes provable from explicit participants.
 * Ambiguous text is deliberately left untouched.
 */
export function correctSameLayerMessage(source, options = {}) {
    const original = String(source ?? '');
    if (!original || !/wxchead|wxhead|\bwx\s*[｜丨|]/i.test(original)) {
        return { text: original, changes: [] };
    }

    const lines = original.split(/(\r?\n)/);
    const changes = [];
    let context = null;
    let fenced = false;
    let visibleLine = 0;

    for (let index = 0; index < lines.length; index += 2) {
        const line = lines[index];
        visibleLine += 1;
        if (/^\s*```/.test(line)) {
            fenced = !fenced;
            continue;
        }
        if (fenced) continue;

        const privateHeader = line.match(PRIVATE_HEADER_RE);
        if (privateHeader) {
            context = null;
            const users = nameSet(options.userName, '{{user}}', '{user}', 'user', '用户');
            if (!isNamed(privateHeader[2], users)) continue;
            const peers = new Map();
            let ambiguous = false;
            for (let next = index + 2; next < lines.length; next += 2) {
                if (ANY_HEADER_RE.test(lines[next]) || /^\s*```/.test(lines[next])) break;
                const message = lines[next].match(WX_RE);
                if (!message) continue;
                const sender = message[2].trim(), recipient = message[3].trim();
                const fromUser = isNamed(sender, users), toUser = isNamed(recipient, users);
                if (fromUser === toUser) { ambiguous = true; continue; }
                let peer = fromUser ? recipient : sender;
                if (/^(?:\{\{char\}\}|\{char\}|char)$/i.test(peer)) peer = options.charName || '';
                if (!peer || /^(?:我|你|他|她|本人|对方|NPC)$/i.test(peer) || isNamed(peer, users)) { ambiguous = true; continue; }
                peers.set(normalizeName(peer), peer);
            }
            if (!ambiguous && peers.size === 1) {
                const after = `${privateHeader[1]}wxhead｜${peers.values().next().value}`;
                lines[index] = after;
                changes.push({ line: visibleLine, reason: '私聊会话头误写为用户，按消息双方修正为实际对方', before: line, after });
            }
            continue;
        }

        const header = line.match(HEADER_RE);
        if (header) {
            context = { right: header[1].trim(), left: header[2].trim() };
            continue;
        }
        if (ANY_HEADER_RE.test(line)) {
            context = null;
            continue;
        }
        if (!context) continue;

        const corrected = correctLine(line, context, options, visibleLine);
        if (!corrected) continue;
        lines[index] = corrected.after;
        changes.push(corrected.change);
    }

    return { text: lines.join(''), changes };
}
