import re

css_path = 'popup.css'
with open(css_path, 'r', encoding='utf-8') as f:
    css = f.read()

# the classes to change border-radius to 8px
def modify_border_radius(css, class_names):
    for cls in class_names:
        # Regex to find `cls { ... border-radius: XXpx; ... }`
        # Note: Some classes might be on the same line, some spread out.
        # This simpler approach just replaces border-radius within the block
        # Actually it's easier to just match `.class { ... }` or use string replacement if we know the exact lines
        pass

# Since we clearly know the classes, let's just regex search for them and replace.
classes = [
    r'\.card',
    r'\.work-card',
    r'\.task-item',
    r'\.card-overview',
    r'\.card-tabs',
    r'\.card-screenshot',
    r'\.task-desc',  # margin-top: 12px; border-left: 3px solid #a4ffb6; border-radius: 10px; -> wait it's 10px, change to 8px
    r'\.archived-tasks-toggle',
    r'\.task-classify-dropdown',
    r'\.dropdown-menu',
    r'\.custom-modal'
]

for cls in classes:
    # Need to match the class block
    pattern = cls + r'[^{]*\{([^}]*border-radius:\s*\d+px;[^}]*)\}'
    def repl(m):
        inner = re.sub(r'border-radius:\s*\d+px;', 'border-radius: 8px;', m.group(1))
        return cls.replace('\\', '') + ' {' + inner + '}'
    css = re.sub(pattern, repl, css)

# Wait! custom-modal could be .custom-modal { ... } and .custom-modal-overlay.hidden .custom-modal { ... }
# To be safe, let's just do an easier regex: Look for every CSS rule definition that contains one of the classes.
# But CSS syntax can be multi-line.
EOF
