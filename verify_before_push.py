#!/usr/bin/env python3
"""
AClean WebApp — Pre-Push Vercel Build Verifier
Run SEBELUM push ke GitHub.
Usage: python3 verify_before_push.py src/App.jsx
"""
import sys

def verify(filepath):
    with open(filepath) as f:
        content = f.read()
        lines = content.split('\n')
    
    errors = []
    
    # 1. Balance {}
    bal_brace = content.count('{') - content.count('}')
    if bal_brace != 0: 
        errors.append(f"Balance {{}} = {bal_brace} (harus 0)")
    
    # 2. Multiline backtick — skip outer templates
    in_outer_template = False
    outer_template_markers = [
        'const html = `', 'const BRAIN_MD_DEFAULT = `',
        '<style>{`', 'const sysP = '
    ]
    in_bt = False
    bt_line = -1
    
    for i, l in enumerate(lines):
        # Track outer template
        for marker in outer_template_markers:
            if marker in l and not in_outer_template:
                in_outer_template = True
        if in_outer_template and ('`;' in l or '`}' in l):
            # Check if this closes the outer template
            bt_count = sum(1 for j,c in enumerate(l) 
                          if c=='`' and (j==0 or l[j-1]!='\\'))
            if bt_count % 2 == 1:
                in_outer_template = False
                continue
        
        if in_outer_template:
            continue  # Skip all lines inside outer templates
        
        # Count backticks per line
        j = 0
        while j < len(l):
            if l[j] == '\\' and j+1 < len(l): j += 2; continue
            if l[j] == '`':
                if not in_bt: in_bt = True; bt_line = i
                else:
                    in_bt = False
                    if bt_line != i:
                        ctx = lines[bt_line].strip()
                        # Safe: var assignments, string concat patterns
                        safe = any(k in ctx for k in [
                            'const msg =', 'helperMsg =', 'custMsg =', 'rMsg =',
                            'const dispatch', '` +', '+ `',
                        ])
                        if not safe:
                            errors.append(f"Multiline backtick L{bt_line+1}-{i+1}: {ctx[:60]}")
            j += 1
    
    # 3. window.prompt / window.confirm
    for i, l in enumerate(lines):
        stripped = l.strip()
        if 'window.prompt(' in l and '// window.prompt' not in l and not stripped.startswith('//'):
            errors.append(f"Active window.prompt at L{i+1}")
        if 'window.confirm(' in l and not stripped.startswith('//') and '{/*' not in stripped[:4]:
            errors.append(f"Active window.confirm at L{i+1}")
    
    # 4. Common JSX syntax errors
    if '✓ Diverifikasi{inv?`' in content:
        errors.append("Backtick in JSX text: '✓ Diverifikasi{inv?`'")
    
    if errors:
        print(f"❌ JANGAN PUSH — {len(errors)} masalah:")
        for e in errors: print(f"   • {e}")
        return False
    else:
        print(f"✅ AMAN PUSH — {len(lines)} lines, balance OK, tidak ada backtick issue")
        return True

if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "src/App.jsx"
    ok = verify(path)
    sys.exit(0 if ok else 1)
