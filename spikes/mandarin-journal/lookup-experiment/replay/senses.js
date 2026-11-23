const senseTrials = [
  {
    "id": "newsstand",
    "kind": "selection",
    "text": "河边那座旧报刊亭关了三年。",
    "start": 5,
    "end": 8,
    "intent": "A concrete object where the single-word reminder already suffices. Expected decision: newsstand.",
    "results": [
      {
        "model": "Instant reminder",
        "ms": 0,
        "answer": {
          "span": "报刊亭",
          "pinyin": "bàokāntíng",
          "gloss": "newsstand"
        }
      },
      {
        "model": "Selected label · google/gemini-3.5-flash-lite",
        "ms": 1023,
        "answer": {
          "span": "报刊亭",
          "pinyin": "bàokāntíng",
          "gloss": "newsstand"
        }
      },
      {
        "model": "Contextual gloss · gpt-6.2-sol",
        "ms": 3032,
        "answer": {
          "span": "报刊亭",
          "pinyin": "bàokāntíng",
          "gloss": "newsstand (a kiosk selling newspapers and magazines)",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "second-return",
    "kind": "selection",
    "text": "借的伞还没还，我明天就送回去。",
    "start": 5,
    "end": 6,
    "intent": "The second occurrence means return the umbrella. Expected decision: give something back.",
    "results": [
      {
        "model": "Instant reminder",
        "ms": 0,
        "answer": {
          "span": "还",
          "pinyin": "hái / huán",
          "gloss": "still, also / give back"
        }
      },
      {
        "model": "Selected label · google/gemini-3.5-flash-lite",
        "ms": 669,
        "answer": {
          "span": "还",
          "pinyin": "huán",
          "gloss": "give something back"
        }
      },
      {
        "model": "Contextual gloss · gpt-6.2-sol",
        "ms": 2054,
        "answer": {
          "span": "还",
          "pinyin": "huán",
          "gloss": "to return something borrowed; the umbrella hasn’t been returned yet",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "first-still",
    "kind": "selection",
    "text": "借的伞还没还，我明天就送回去。",
    "start": 3,
    "end": 4,
    "intent": "The first occurrence means still. Expected decision: still, continuing to be the case.",
    "results": [
      {
        "model": "Instant reminder",
        "ms": 0,
        "answer": {
          "span": "还",
          "pinyin": "hái / huán",
          "gloss": "still, also / give back"
        }
      },
      {
        "model": "Selected label · google/gemini-3.5-flash-lite",
        "ms": 711,
        "answer": {
          "span": "还",
          "pinyin": "huán",
          "gloss": "give something back"
        }
      },
      {
        "model": "Contextual gloss · gpt-6.2-sol",
        "ms": 1919,
        "answer": {
          "span": "还",
          "pinyin": "hái",
          "gloss": "still; with 没还 (méi huán), it means the borrowed umbrella hasn’t been returned yet.",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "also",
    "kind": "selection",
    "text": "她除了会弹琴，还会修琴。",
    "start": 7,
    "end": 8,
    "intent": "An additional skill. Expected decision: also, in addition.",
    "results": [
      {
        "model": "Instant reminder",
        "ms": 0,
        "answer": {
          "span": "还",
          "pinyin": "hái / huán",
          "gloss": "still, also / give back"
        }
      },
      {
        "model": "Selected label · google/gemini-3.5-flash-lite",
        "ms": 724,
        "answer": {
          "span": "还",
          "pinyin": "hái",
          "gloss": "also, in addition"
        }
      },
      {
        "model": "Contextual gloss · gpt-6.2-sol",
        "ms": 1914,
        "answer": {
          "span": "还",
          "pinyin": "hái",
          "gloss": "also; in the 除了…还… pattern, it adds that she can repair the instrument as well as play it.",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "foam",
    "kind": "selection",
    "text": "洗碗池里堆着厚厚一层泡沫。",
    "start": 10,
    "end": 12,
    "intent": "Physical suds. Expected decision: Foam or lather.",
    "results": [
      {
        "model": "Instant reminder",
        "ms": 0,
        "answer": {
          "span": "泡沫",
          "pinyin": "pàomò",
          "gloss": "foam, bubbles"
        }
      },
      {
        "model": "Selected label · google/gemini-3.5-flash-lite",
        "ms": 551,
        "answer": {
          "span": "泡沫",
          "pinyin": "pàomò",
          "gloss": "Foam or lather"
        }
      },
      {
        "model": "Contextual gloss · gpt-6.2-sol",
        "ms": 1776,
        "answer": {
          "span": "泡沫",
          "pinyin": "pàomò",
          "gloss": "suds; soapy foam",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "bubble",
    "kind": "selection",
    "text": "价格远超实际价值，他担心这是一场泡沫。",
    "start": 16,
    "end": 18,
    "intent": "Inflated value. Expected decision: Speculative or inflated bubble.",
    "results": [
      {
        "model": "Instant reminder",
        "ms": 0,
        "answer": {
          "span": "泡沫",
          "pinyin": "pàomò",
          "gloss": "foam, bubbles"
        }
      },
      {
        "model": "Selected label · google/gemini-3.5-flash-lite",
        "ms": 688,
        "answer": {
          "span": "泡沫",
          "pinyin": "pàomò",
          "gloss": "Speculative or inflated bubble"
        }
      },
      {
        "model": "Contextual gloss · gpt-6.2-sol",
        "ms": 2559,
        "answer": {
          "span": "泡沫",
          "pinyin": "pàomò",
          "gloss": "a bubble: prices inflated far above what something is really worth",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "missing-bubble",
    "kind": "selection",
    "text": "估值涨了十倍，投资者担心泡沫会破。",
    "start": 12,
    "end": 14,
    "intent": "Figurative use was deliberately omitted from the candidates. Expected decision: Defer to context.",
    "results": [
      {
        "model": "Instant reminder",
        "ms": 0,
        "answer": {
          "span": "泡沫",
          "pinyin": "pàomò",
          "gloss": "foam, bubbles"
        }
      },
      {
        "model": "Selected label · google/gemini-3.5-flash-lite",
        "ms": 671,
        "answer": null
      },
      {
        "model": "Contextual gloss · gpt-6.2-sol",
        "ms": 2311,
        "answer": {
          "span": "泡沫",
          "pinyin": "pàomò",
          "gloss": "a financial bubble (unsustainably high valuations)",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "cannot-bear",
    "kind": "selection",
    "text": "老桥早已不堪重负，只好暂时封闭。",
    "start": 4,
    "end": 6,
    "intent": "Unable to withstand the load. Expected decision: cannot bear or withstand.",
    "results": [
      {
        "model": "Instant reminder",
        "ms": 0,
        "answer": {
          "span": "不堪",
          "pinyin": "bùkān",
          "gloss": "unable to bear"
        }
      },
      {
        "model": "Selected label · google/gemini-3.5-flash-lite",
        "ms": 645,
        "answer": {
          "span": "不堪",
          "pinyin": "bùkān",
          "gloss": "cannot bear or withstand"
        }
      },
      {
        "model": "Contextual gloss · gpt-6.2-sol",
        "ms": 1580,
        "answer": {
          "span": "不堪",
          "pinyin": "bù kān",
          "gloss": "unable to bear (the heavy load)",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "extremely",
    "kind": "selection",
    "text": "忙了三天，他已经疲惫不堪。",
    "start": 10,
    "end": 12,
    "intent": "Post-adjective intensifier. Expected decision: extremely; to an unbearable degree.",
    "results": [
      {
        "model": "Instant reminder",
        "ms": 0,
        "answer": {
          "span": "不堪",
          "pinyin": "bùkān",
          "gloss": "unable to bear"
        }
      },
      {
        "model": "Selected label · google/gemini-3.5-flash-lite",
        "ms": 690,
        "answer": {
          "span": "不堪",
          "pinyin": "bùkān",
          "gloss": "extremely; to an unbearable degree"
        }
      },
      {
        "model": "Contextual gloss · gpt-6.2-sol",
        "ms": 2456,
        "answer": {
          "span": "不堪",
          "pinyin": "bùkān",
          "gloss": "In 疲惫不堪, it intensifies 疲惫: “utterly exhausted.”",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "compound",
    "kind": "selection",
    "text": "得知祖父病情垂危，她连夜赶回家。",
    "start": 6,
    "end": 7,
    "intent": "The physical sense does not apply inside 垂危. Expected decision: Defer to context.",
    "results": [
      {
        "model": "Instant reminder",
        "ms": 0,
        "answer": {
          "span": "垂",
          "pinyin": "chuí",
          "gloss": "hang down"
        }
      },
      {
        "model": "Selected label · google/gemini-3.5-flash-lite",
        "ms": 820,
        "answer": null
      },
      {
        "model": "Contextual gloss · gpt-6.2-sol",
        "ms": 1942,
        "answer": {
          "span": "垂",
          "pinyin": "chuí",
          "gloss": "The first character of 垂危, meaning “critically ill and near death” here.",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "degree",
    "kind": "selection",
    "text": "修缮以后，屋里的采光有所改善。",
    "start": 10,
    "end": 12,
    "intent": "The improvement is qualified in degree. Expected decision: to some extent; show a certain degree of change.",
    "results": [
      {
        "model": "Instant reminder",
        "ms": 0,
        "answer": {
          "span": "有所",
          "pinyin": "yǒusuǒ",
          "gloss": "to some extent"
        }
      },
      {
        "model": "Selected label · google/gemini-3.5-flash-lite",
        "ms": 779,
        "answer": {
          "span": "有所",
          "pinyin": "yǒusuǒ",
          "gloss": "to some extent; show a certain degree of change"
        }
      },
      {
        "model": "Contextual gloss · gpt-6.2-sol",
        "ms": 1828,
        "answer": {
          "span": "有所",
          "pinyin": "yǒusuǒ",
          "gloss": "to some extent (the light in the room improved somewhat)",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "grant",
    "kind": "selection",
    "text": "校方授与她名誉学位。",
    "start": 3,
    "end": 4,
    "intent": "The marked character belongs to 授与. Expected decision: Defer to context.",
    "results": [
      {
        "model": "Instant reminder",
        "ms": 0,
        "answer": {
          "span": "与",
          "pinyin": "yǔ",
          "gloss": "and, with"
        }
      },
      {
        "model": "Selected label · google/gemini-3.5-flash-lite",
        "ms": 715,
        "answer": {
          "span": "与",
          "pinyin": "yǔ",
          "gloss": "give; grant"
        }
      },
      {
        "model": "Contextual gloss · gpt-6.2-sol",
        "ms": 2502,
        "answer": {
          "span": "与",
          "pinyin": "yǔ",
          "gloss": "The second character of 授与, “to confer,” here referring to the school awarding her an honorary degree.",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "saying",
    "kind": "selection",
    "text": "他自作主张改了报价，结果聪明反被聪明误。",
    "start": 12,
    "end": 19,
    "intent": "The scheme backfired. Compare reminder with a gloss tied to the actor. Expected decision: to outsmart oneself.",
    "results": [
      {
        "model": "Instant reminder",
        "ms": 0,
        "answer": {
          "span": "聪明反被聪明误",
          "pinyin": "cōngming fǎn bèi cōngming wù",
          "gloss": "too clever for one’s own good"
        }
      },
      {
        "model": "Selected label · google/gemini-3.5-flash-lite",
        "ms": 722,
        "answer": {
          "span": "聪明反被聪明误",
          "pinyin": "cōngming fǎn bèi cōngming wù",
          "gloss": "to outsmart oneself"
        }
      },
      {
        "model": "Contextual gloss · gpt-6.2-sol",
        "ms": 1801,
        "answer": {
          "span": "聪明反被聪明误",
          "pinyin": "cōngming fǎn bèi cōngming wù",
          "gloss": "His own cleverness ended up backfiring on him.",
          "chunks": []
        }
      }
    ]
  },
  {
    "id": "ambiguous",
    "kind": "selection",
    "text": "纸上只写了一个“还”字。",
    "start": 8,
    "end": 9,
    "intent": "The quoted character has no context to resolve its reading. Expected decision: Defer to context.",
    "results": [
      {
        "model": "Instant reminder",
        "ms": 0,
        "answer": {
          "span": "还",
          "pinyin": "hái / huán",
          "gloss": "still, also / give back"
        }
      },
      {
        "model": "Selected label · google/gemini-3.5-flash-lite",
        "ms": 813,
        "answer": null
      },
      {
        "model": "Contextual gloss · gpt-6.2-sol",
        "ms": 2075,
        "answer": {
          "span": "还",
          "pinyin": "hái / huán",
          "gloss": "Only the written character is given, so the reading is unclear: hái (‘still’) or huán (‘return’).",
          "chunks": []
        }
      }
    ]
  }
];
