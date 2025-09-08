# wordmapbooster
WordMapBooster is an extension on [WordMap](https://github.com/unfoldingWord/wordMAP).  WordMapBooster adds a Javascript tree based model for establishing alignment statistic relevance. 

[boostwordmapwithfs](https://github.com/JEdward7777/boostwordmapwithfs) is a node project which allows WordMapBooster to be run against usfm code in a node environment without being encumbered by the memory restrictions of a browser.

This tool is demoed with [Alignment Transferer](https://github.com/JEdward7777/alignment-transferer). [Netlify demo](https://alignment-transferer.netlify.app/).

## Installation

### npm
```bash
yarn add wordmapbooster
```

### yarn
```bash
yarn add wordmapbooster
```

## Data Format
Interactions with the WordMapBooster api use the data classes as established by [WordMap](https://github.com/unfoldingWord/wordMAP).

### Terms
Data is added as corpus data and as alignment data.  
* `Corpus data` is bulk data which includes aligned and unaligned data in verse pairs between source and target languages.  This gives statistical context for the Alignment data to compute against.
* `Alignment data` is n-gram to n-gram pairs between source and target languages for established alignments.  This provides the data for the model to train on.


### Classes
The following class references are needed when interacting with the WordMapBooster api.
* `Corpus data` is composed as array of source [Token](https://github.com/unfoldingWord/wordMAP-lexer/blob/develop/src/Token.ts)s and target Tokens per verse.

* `Alignment data` is an array of [Alignment](https://github.com/unfoldingWord/wordMAP/blob/master/src/core/Alignment.ts) objects.

* `Alignment object`: A [Alignment](https://github.com/unfoldingWord/wordMAP/blob/master/src/core/Alignment.ts) object is constructed from a source and target [Ngram](https://github.com/unfoldingWord/wordMAP/blob/master/src/core/Ngram.ts).  The point of an Ngram is that a word in the source language can actually be related to multiple words in the target language or vis versa.

* `Ngram`: A [Ngram](https://github.com/unfoldingWord/wordMAP/blob/master/src/core/Ngram.ts) is constructed from an array of one or more [Token](https://github.com/unfoldingWord/wordMAP-lexer/blob/develop/src/Token.ts)s.


* `Token`: A [Token](https://github.com/unfoldingWord/wordMAP-lexer/blob/develop/src/Token.ts) is constructed from a dict with the most important information being 
  - `text` The word that the token represents.
  - `morph` The morphology code for the specific token.

  The rest of the the information is added by the library when the Token is used.

### API
1. Create an instance of one of the following models:
    * `JLBoostWordMap`: [JLBoostWordMap](https://github.com/JEdward7777/wordmapbooster/blob/master/src/boostwordmap_tools.ts#L679) does not take morphology into consideration when making wordmap suggestions.  
    * `MorphJLBoostWordMap`: [MorphJLBoostWordMap](https://github.com/JEdward7777/wordmapbooster/blob/master/src/boostwordmap_tools.ts#L755) does take morphology into consideration when making wordmap suggestions.

    The object takes the following arguments:
    * `train_steps`:  This is the number of iterations that the model trains before being able to make predictions.  The default is `1000`.
    * `learning_rate`:  This how fast the model converges on the information.  The default is `0.7`.
    * `tree_depth`: This is the number of splits in each tree which is generated each successful train_steps step.  The default is `5`.

    The [WordMap](https://github.com/unfoldingWord/wordMAP/blob/master/src/core/WordMap.ts) arguments are also supported which these were used in testing.
    * `targetNgramLength`: This limits the permutation search space which the WordMap Engine grinds through.  The value used in testing is `5`.
    * `warnings`: The value used in testing is `false`.
    * `forceOccurrenceOrder`: Forces suggestions to preserve the order of word occurrences.  The value used in testing is `false`.

    targetNgramLength: 5, warnings: false, forceOccurrenceOrder:false

2. Pass in the corpus data.  This is done with `appendKeyedCorpusTokens`.  This is one function call for adding all the source and target text.  The first argument is the    
    * `corpusSourceText` which is a dictionary from a string verse identifier to the array of Tokens.  The format of the string identifier can be whatever as long as it corresponds with the second argument.  In the case of the NT this is Greek.  In the case of the OT, this is majoritively Hebrew.
    * `corpusTargetText` which is a dictionary keyed by the same string verse identifiers to the array of Target text.  In the case of Greek to English, this is the English.

    The corpus data is passed in for both the already aligned and not yet aligned data.

3. Add in the alignment data.  This is done with `add_alignments_2` or `add_alignments_4`.  `add_alignments_4` is more computationally intensive but does better with less data such as only Titus, but the benefits wash out with a larger book such as with Matthew.  The arguments are
    * `sourceText`: This is the same data which is passed as the first argument to `appendKeyedCorpusTokens`.
    * `targetText`: Same as second argument to `appendKeyedCorpusTokens`.
    * `alignments`: This is a dictionary keyed from the same string verse identifiers to arrays of [Alignment](https://github.com/unfoldingWord/wordMAP/blob/master/src/core/Alignment.ts)s.  These are the manually completed alignments which are then used as training for the model to make predictions with.

   This function is async and should be called with async or deal handle the returned promise.  The promise will resolve once the model has completed training and predictions can be performed.

4. Optionally the model can be serialized.  This makes it possible to train the model in a browser worker thread which is what is done in the [Alignment Transferer](https://github.com/JEdward7777/alignment-transferer/blob/master/src/workers/AlignmentTrainer.ts) demo of this module.  This also makes it possible to save and restore the model from disk or to train the model in the cloud and then ship the model to the browser just for inference.
    * `save`: This converts the trained model into a JSON-able set of arrays and dictionaries.
    * `AbstractWordMapWrapper.load`: This load converts set of arrays and dictionaries and converts it back into the model.  The saved data self indexes which model type was saved, so the right model is reproduced.
    * `AbstractWordMapWrapper.async_load`: This is the same as load, but is an async version which utilizes setTimeout to yield the cpu to keep from freezing everything during a long load.

5. Predictions are run on the model to get [suggestion](https://github.com/unfoldingWord/wordMAP/blob/master/src/core/Suggestion.ts)s.  This is done by running the `predict` method.  The first argument is an array of Tokens for the  
    * `sourceSentence`.  The second argument is an array of Tokens for the `targetSentence`.  Technically you can pass in strings instead but then you can't pass in morphological information on the Tokens.
    * `maxSuggestions`: The result is an array of suggested alignments, this gives the number that you want.
    * `manuallyAligned`: This is an array of Alignment's which should be respected when constructing the suggestions.  This way if the aligner is half done aligning the verse, the tool will not make suggestions which are incompatible with the alignments already completed.

   Once The Suggestions have been returned, you can access the Alignments by calling `getPredictions` to get the Predictions and then calling `alignment` to get the Alignment out of the Prediction.  The confidence of each individual Alignment is accessed by `getScore("confidence")` on the prediction.  Please follow the object documentation or reference the following examples to see how this is further broken down into ngrams and tokens.

### Examples

Examples of using this module can be obtained by referencing three different places.

1. `The test code`.  This module is tested with jest tests.  Please see the [JLBoostWordMap test code](https://github.com/JEdward7777/wordmapbooster/blob/master/__tests__/boostwordmap_tools.test.ts) for examples of constructing the object, feeding it data and training it.

2. `Alignment Transferer`.  The react demo application developed along with this code has a background thread which trains this model.  You can see can see the [background thread's implementation](https://github.com/JEdward7777/alignment-transferer/blob/master/src/workers/AlignmentTrainer.ts)

3. `boostwordmapwithfs`.  There is also a node project which is used to test this module.  This project is not limited by the memory constraints found in a WebBrowser.  This project does not have an interface built for it but expects the source to be modified for individual tests.  [run_alignment_tests.ts](https://github.com/JEdward7777/boostwordmapwithfs/blob/master/dev_scripts/run_alignment_tests.ts) is the main entry point of this project.

## Publishing

### npm
```bash
 npm i --legacy-peer-deps && npm run build && npm publish
```
