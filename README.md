A discord bot that was created for a community "Risk" event in a videogame.

The ADJACENCY maps the connections between all the ingame regions.

Command format is /risk YOUR_TEAM_COLOR POINT_VALUE REGION_NAME and it handles the backend logic automatically.

Internal scoring logic and output is decided as described below:
  Each region has one number: the owner's net lead (balance).
    Own region:   balance += points          → FORTIFY
    Neutral:      claim it, balance = points → EXPAND
    Enemy region: net = balance - points
      net > 0  → ATTACK      (enemy keeps it, balance reduced)
      net = 0  → NEUTRALISED (goes neutral, next team claims it)
      net < 0  → CONQUER     (you take it, balance = overflow)
