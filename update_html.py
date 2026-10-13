with open("popup.html", "r", encoding="utf-8") as f:
    html = f.read()

# We need to take out the settings panel from 'page-archive' and make it a separate modal or float right top
# Let's inspect popup.html line 13 to 30 to see the header structure
