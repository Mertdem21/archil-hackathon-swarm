# Glossary

**Checker**: An agent that judges code for one bug class and reports findings.
_Avoid_: verifier, reviewer, scanner (as umbrella terms)

**Finding**: One problem that a checker reports, with file, line, bug class and reason.

**Seeded bug**: A known bug planted in the demo repo so that the result can be scored.

**Answer key**: The list of seeded bugs, which the checkers never see.

**Scan**: One run of all checkers over one repo, ending in one report.
