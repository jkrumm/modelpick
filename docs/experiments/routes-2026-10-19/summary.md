# Route bench

| model | kind | pass | median s | mean turns | total cost | mean cost | cache-hit | max mean prompt/turn |
|-|-|-|-|-|-|-|-|-|
| deepseek-v4.1-flash | implement | 6/6 | 43 | 23.0 | $0.0992 | $0.0165 | 93% | 61831 |
| deepseek-v4.1-flash | investigate | 6/6 | 6 | 4.2 | $0.0272 | $0.0045 | 74% | 26518 |
| deepseek-v4.1-flash | review | 12/12 | 97 | 15.1 | $0.2621 | $0.0218 | 92% | 66050 |
| claude-haiku-5-5-eu | implement | 6/6 | 29 | 10.5 | $0.0986 | $0.0164 | 100% | 65571 |
| claude-haiku-5-5-eu | investigate | 6/6 | 6 | 2.8 | $0.0325 | $0.0054 | 100% | 37267 |
| claude-haiku-5-5-eu | review | 12/12 | 21 | 3.3 | $0.1234 | $0.0103 | 100% | 54452 |

## Cells

| model | task | rep | pass | s | turns | cost | cache-hit | detail |
|-|-|-|-|-|-|-|-|-|
| deepseek-v4.1-flash | warden-board-null-repo | 1 | yes | 42 | 13 | $0.0111 | 92% | tests pass, 2 files |
| deepseek-v4.1-flash | warden-board-null-repo | 2 | yes | 19 | 7 | $0.0069 | 85% | tests pass, 2 files |
| deepseek-v4.1-flash | routing-per-angle-fallback | 1 | yes | 43 | 12 | $0.0109 | 92% | tests pass, 2 files |
| deepseek-v4.1-flash | routing-per-angle-fallback | 2 | yes | 43 | 11 | $0.0113 | 91% | tests pass, 2 files |
| deepseek-v4.1-flash | check-make-target-prereq | 1 | yes | 142 | 45 | $0.0237 | 98% | tests pass, 2 files |
| deepseek-v4.1-flash | check-make-target-prereq | 2 | yes | 187 | 50 | $0.0353 | 98% | tests pass, 2 files |
| deepseek-v4.1-flash | wire-to-provider | 1 | yes | 6 | 3 | $0.0044 | 65% | all expected terms present |
| deepseek-v4.1-flash | wire-to-provider | 2 | yes | 6 | 3 | $0.0039 | 69% | all expected terms present |
| deepseek-v4.1-flash | idle-watchdog | 1 | yes | 11 | 6 | $0.0053 | 82% | all expected terms present |
| deepseek-v4.1-flash | idle-watchdog | 2 | yes | 6 | 3 | $0.0041 | 68% | all expected terms present |
| deepseek-v4.1-flash | repo-lease | 1 | yes | 11 | 5 | $0.0048 | 80% | all expected terms present |
| deepseek-v4.1-flash | repo-lease | 2 | yes | 9 | 5 | $0.0047 | 80% | all expected terms present |
| deepseek-v4.1-flash | make-check-target/senior-dev | 1 | yes | 154 | 10 | $0.0288 | 88% | 6 findings; hints 2/4 (text-vs-rule, orphaned-children) |
| deepseek-v4.1-flash | make-check-target/senior-dev | 2 | yes | 140 | 13 | $0.0270 | 92% | 9 findings; hints 2/4 (text-vs-rule, orphaned-children) |
| deepseek-v4.1-flash | make-check-target/typescript | 1 | yes | 195 | 22 | $0.0362 | 95% | 9 findings; hints 2/4 (text-vs-rule, orphaned-children) |
| deepseek-v4.1-flash | make-check-target/typescript | 2 | yes | 107 | 11 | $0.0200 | 90% | 7 findings; hints 2/4 (text-vs-rule, orphaned-children) |
| deepseek-v4.1-flash | make-check-target/qa | 1 | yes | 147 | 16 | $0.0259 | 94% | 8 findings; hints 2/4 (text-vs-rule, orphaned-children) |
| deepseek-v4.1-flash | make-check-target/qa | 2 | yes | 119 | 11 | $0.0210 | 91% | 9 findings; hints 2/4 (text-vs-rule, orphaned-children) |
| deepseek-v4.1-flash | opencode-2x-stream/senior-dev | 1 | yes | 97 | 20 | $0.0216 | 95% | 7 findings; hints 3/4 (final-text, mid-loop-step-finish, pwd-or-usage) |
| deepseek-v4.1-flash | opencode-2x-stream/senior-dev | 2 | yes | 96 | 14 | $0.0184 | 92% | 6 findings; hints 3/4 (final-text, mid-loop-step-finish, env-precedence) |
| deepseek-v4.1-flash | opencode-2x-stream/typescript | 1 | yes | 65 | 9 | $0.0145 | 87% | 5 findings; hints 2/4 (final-text, mid-loop-step-finish) |
| deepseek-v4.1-flash | opencode-2x-stream/typescript | 2 | yes | 88 | 18 | $0.0182 | 94% | 5 findings; hints 3/4 (final-text, mid-loop-step-finish, pwd-or-usage) |
| deepseek-v4.1-flash | opencode-2x-stream/qa | 1 | yes | 82 | 24 | $0.0178 | 95% | 7 findings; hints 3/4 (final-text, mid-loop-step-finish, pwd-or-usage) |
| deepseek-v4.1-flash | opencode-2x-stream/qa | 2 | yes | 58 | 13 | $0.0127 | 91% | 5 findings; hints 3/4 (final-text, mid-loop-step-finish, pwd-or-usage) |
| claude-haiku-5-5-eu | warden-board-null-repo | 1 | yes | 33 | 8 | $0.0102 | 100% | tests pass, 2 files |
| claude-haiku-5-5-eu | warden-board-null-repo | 2 | yes | 19 | 6 | $0.0087 | 100% | tests pass, 2 files |
| claude-haiku-5-5-eu | routing-per-angle-fallback | 1 | yes | 29 | 8 | $0.0130 | 100% | tests pass, 2 files |
| claude-haiku-5-5-eu | routing-per-angle-fallback | 2 | yes | 25 | 7 | $0.0122 | 100% | tests pass, 2 files |
| claude-haiku-5-5-eu | check-make-target-prereq | 1 | yes | 352 | 22 | $0.0325 | 100% | tests pass, 2 files |
| claude-haiku-5-5-eu | check-make-target-prereq | 2 | yes | 73 | 12 | $0.0219 | 100% | tests pass, 2 files |
| claude-haiku-5-5-eu | wire-to-provider | 1 | yes | 8 | 4 | $0.0057 | 100% | all expected terms present |
| claude-haiku-5-5-eu | wire-to-provider | 2 | yes | 6 | 3 | $0.0054 | 100% | all expected terms present |
| claude-haiku-5-5-eu | idle-watchdog | 1 | yes | 4 | 2 | $0.0051 | 100% | all expected terms present |
| claude-haiku-5-5-eu | idle-watchdog | 2 | yes | 3 | 2 | $0.0049 | 100% | all expected terms present |
| claude-haiku-5-5-eu | repo-lease | 1 | yes | 7 | 3 | $0.0054 | 100% | all expected terms present |
| claude-haiku-5-5-eu | repo-lease | 2 | yes | 7 | 3 | $0.0060 | 100% | all expected terms present |
| claude-haiku-5-5-eu | make-check-target/senior-dev | 1 | yes | 41 | 3 | $0.0121 | 100% | 10 findings; hints 2/4 (text-vs-rule, orphaned-children) |
| claude-haiku-5-5-eu | make-check-target/senior-dev | 2 | yes | 23 | 2 | $0.0089 | 100% | 8 findings; hints 2/4 (text-vs-rule, orphaned-children) |
| claude-haiku-5-5-eu | make-check-target/typescript | 1 | yes | 21 | 2 | $0.0088 | 100% | 3 findings; hints 2/4 (text-vs-rule, orphaned-children) |
| claude-haiku-5-5-eu | make-check-target/typescript | 2 | yes | 38 | 5 | $0.0134 | 100% | 2 findings; hints 2/4 (text-vs-rule, orphaned-children) |
| claude-haiku-5-5-eu | make-check-target/qa | 1 | yes | 24 | 4 | $0.0106 | 100% | 5 findings; hints 2/4 (text-vs-rule, orphaned-children) |
| claude-haiku-5-5-eu | make-check-target/qa | 2 | yes | 24 | 4 | $0.0105 | 100% | 7 findings; hints 2/4 (text-vs-rule, orphaned-children) |
| claude-haiku-5-5-eu | opencode-2x-stream/senior-dev | 1 | yes | 15 | 2 | $0.0086 | 100% | 7 findings; hints 3/4 (final-text, mid-loop-step-finish, env-precedence) |
| claude-haiku-5-5-eu | opencode-2x-stream/senior-dev | 2 | yes | 13 | 2 | $0.0084 | 100% | 6 findings; hints 2/4 (final-text, mid-loop-step-finish) |
| claude-haiku-5-5-eu | opencode-2x-stream/typescript | 1 | yes | 14 | 3 | $0.0091 | 100% | 1 findings; hints 2/4 (final-text, mid-loop-step-finish) |
| claude-haiku-5-5-eu | opencode-2x-stream/typescript | 2 | yes | 16 | 4 | $0.0102 | 100% | 3 findings; hints 2/4 (final-text, mid-loop-step-finish) |
| claude-haiku-5-5-eu | opencode-2x-stream/qa | 1 | yes | 21 | 4 | $0.0116 | 100% | 7 findings; hints 4/4 (final-text, mid-loop-step-finish, env-precedence, pwd-or-usage) |
| claude-haiku-5-5-eu | opencode-2x-stream/qa | 2 | yes | 23 | 4 | $0.0113 | 100% | 6 findings; hints 3/4 (final-text, mid-loop-step-finish, env-precedence) |
