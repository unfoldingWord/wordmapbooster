//import {WordMapProps} from "wordmap/core/WordMap"
import WordMap, {
    Alignment,
    AlignmentMemoryIndex,
    CorpusIndex,
    Engine,
    Ngram,
    Suggestion,
    Prediction,
} from 'wordmap';
import Lexer,{Token} from "wordmap-lexer";
import {is_correct_prediction, token_to_hash, updateTokenLocations} from "./wordmap_tools"; 
import {JLBoost} from "./JLBoost";
import { shuffleArray } from './misc_tools';


export const catboost_feature_order : string[] = [
    "sourceCorpusPermutationsFrequencyRatio",
    "targetCorpusPermutationsFrequencyRatio",
    "sourceAlignmentMemoryFrequencyRatio",
    "targetAlignmentMemoryFrequencyRatio",
    "frequencyRatioCorpusFiltered",
    "frequencyRatioAlignmentMemoryFiltered",
    "sourceCorpusLemmaPermutationsFrequencyRatio",
    "targetCorpusLemmaPermutationsFrequencyRatio",
    "sourceAlignmentMemoryLemmaFrequencyRatio",
    "targetAlignmentMemoryLemmaFrequencyRatio",
    "lemmaFrequencyRatioCorpusFiltered",
    "lemmaFrequencyRatioAlignmentMemoryFiltered",
    "ngramRelativeTokenDistance",
    "alignmentRelativeOccurrence",
    "alignmentPosition",
    "phrasePlausibility",
    "lemmaPhrasePlausibility",
    "ngramLength",
    "characterLength",
    "alignmentOccurrences",
    "lemmaAlignmentOccurrences",
    "uniqueness",
    "lemmaUniqueness",
];


/**
 * Hashes an alignment into a dictionary so connections can be looked up.
 * @param sourceToTargetHash the hash that source to targets are hashed into
 * @param targetToSourceHash the hash that targets to source are hashed into
 * @param alignment the alignment to hash connections from.
 */
function addAlignmentToHashes( sourceToTargetHash: {[key: string]: string[] }, targetToSourceHash: {[key: string]: string[] }, alignment: Alignment ){
    for( const sourceToken of alignment.sourceNgram.getTokens() ){
        for( const targetToken of alignment.targetNgram.getTokens() ){
            const sourceHash = token_to_hash( sourceToken );
            const targetHash = token_to_hash( targetToken );
            if( !(sourceHash in sourceToTargetHash) ) sourceToTargetHash[sourceHash] = [];
            if( !(targetHash in targetToSourceHash) ) targetToSourceHash[targetHash] = [];
            sourceToTargetHash[sourceHash].push( targetHash );
            targetToSourceHash[targetHash].push( sourceHash );
        }
    }
}

export abstract class AbstractWordMapWrapper {

    //This used to inherit from WordMap, but a strange
    //bug which was insisting that super be called with new
    //made me just decide to make WordMap a member var.

    protected wordMap: WordMap;
    public engine: Engine; //a convenience alias to inside wordMap.
    protected opts: any; //constructor arguments so we can save it out.

    protected alignmentStash: Alignment[] = [];
    protected sourceCorpusStash: Token[][] = [];
    protected targetCorpusStash: Token[][] = [];


    static load( data: {[key:string]:any}): AbstractWordMapWrapper{
        //switch on the data.classType and load the appropriate class
        const loaders = {
            "PlaneWordMap": PlaneWordMap,
            "JLBoostWordMap": JLBoostWordMap,
            "MorphJLBoostWordMap": MorphJLBoostWordMap,
        };

        // First construct it and then call specificLoad on it.
        const MapperConstructor = loaders[data.classType];
        if (!MapperConstructor) {
            throw new Error(`Unknown classType: ${data.classType}`);
        }

        const mapper = new MapperConstructor(data.opts);


        mapper.specificLoad(data);


        return mapper;
    }

    static async async_load( data: {[key:string]:any}): Promise<AbstractWordMapWrapper>{
        //switch on the data.classType and load the appropriate class
        const loaders = {
            "PlaneWordMap": PlaneWordMap,
            "JLBoostWordMap": JLBoostWordMap,
            "MorphJLBoostWordMap": MorphJLBoostWordMap,
        };

        // First construct it and then call specificLoad on it.
        const MapperConstructor = loaders[data.classType];
        if (!MapperConstructor) {
            throw new Error(`Unknown classType: ${data.classType}`);
        }

        const mapper = new MapperConstructor(data.opts);


        await mapper.async_specificLoad(data);


        return mapper;
    }

    constructor(opts?: {}) {
        //If opts.train_steps is not set, set it to 1000.
        if (!('train_steps' in opts)) opts["train_steps"] = 1000;
        if (!('learning_rate' in opts)) opts["learning_rate"] = 0.7;
        if (!('tree_depth' in opts)) opts["tree_depth"] = 5;

        this.wordMap = new WordMap(opts);
        this.engine = (this.wordMap as any).engine;
        this.opts = opts;
    }


    /**
     * Saves the model to a json-able structure.
     * @returns {Object}
     */
    save(): {[key:string]:any}{
        //Instead of serializing wordMap, serialize the data fed to wordMap.

        const alignmentStashConverted = this.alignmentStash.map( (alignment :Alignment) => {
            return {
                s: alignment.sourceNgram.getTokens().map( (token :Token) => {

                    // Here are the properties of the Token object in Wordmap-Lexer.  How they are fed
                    //in the constructor and how they are accessed in access members is sometimes different.
                    //Going to save them in the way the constructor uses them so that the Token object can be reconstructed.
                    //Just by passing it to the constructor.
                    //https://github.com/unfoldingWord/wordMAP-lexer/blob/develop/src/Token.ts
                    // text: text in toString() out
                    // tokenPos: position
                    // charPos: characterPosition in charPosition out
                    // sentenceCharLen: sentenceCharLen in sentenceCharacterLength out
                    // sentenceTokenLen: sentenceTokenLen in sentenceTokenLength out
                    // tokenOccurrence: occurrence
                    // tokenOccurrences: occurrences
                    // strongNumber: strong
                    // lemmaString: lemma
                    // morphString: morph
                    const tokenConverted = {
                        text: token.toString(),
                    };
                    if( token.position ) tokenConverted["position"] = token.position;
                    if( token.charPosition ) tokenConverted["characterPosition"] = token.charPosition;
                    if( token.sentenceCharacterLength ) tokenConverted["sentenceCharLen"] = token.sentenceCharacterLength;
                    if( token.sentenceTokenLength ) tokenConverted["sentenceTokenLen"] = token.sentenceTokenLength;
                    if( token.occurrence ) tokenConverted["occurrence"] = token.occurrence
                    if( token.occurrences ) tokenConverted["occurrences"] = token.occurrences
                    if( token.strong ) tokenConverted["strong"] = token.strong
                    if( token.lemma ) tokenConverted["lemma"] = token.lemma
                    if( token.morph ) tokenConverted["morph"] = token.morph
                    return tokenConverted;

                }),
                t: alignment.targetNgram.getTokens().map( (token :Token) => {
                    const tokenConverted = {
                        text: token.toString(),
                    };
                    if( token.position ) tokenConverted["position"] = token.position;
                    if( token.charPosition ) tokenConverted["characterPosition"] = token.charPosition;
                    if( token.sentenceCharacterLength ) tokenConverted["sentenceCharLen"] = token.sentenceCharacterLength;
                    if( token.sentenceTokenLength ) tokenConverted["sentenceTokenLen"] = token.sentenceTokenLength;
                    if( token.occurrence ) tokenConverted["occurrence"] = token.occurrence
                    if( token.occurrences ) tokenConverted["occurrences"] = token.occurrences
                    if( token.strong ) tokenConverted["strong"] = token.strong
                    if( token.lemma ) tokenConverted["lemma"] = token.lemma
                    if( token.morph ) tokenConverted["morph"] = token.morph
                    return tokenConverted;
                })
            }
        });

        //don't need to keep as much data in the corpus because the occurrence information can be reconstructed.
        const sourceCorpusStashConverted = this.sourceCorpusStash.map( (tokens :Token[]) => {
            return tokens.map( (token :Token) => {
                const tokenConverted = {
                    text: token.toString(),
                };
                if( token.strong ) tokenConverted["strong"] = token.strong;
                if( token.lemma ) tokenConverted["lemma"] = token.lemma;
                if( token.morph ) tokenConverted["morph"] = token.morph;   
                return tokenConverted;
            })
        })

        const targetCorpusStashConverted = this.targetCorpusStash.map( (tokens :Token[]) => {
            return tokens.map( (token :Token) => {
                const tokenConverted = {
                    text: token.toString(),
                };
                if( token.strong ) tokenConverted["strong"] = token.strong;
                if( token.lemma ) tokenConverted["lemma"] = token.lemma;
                if( token.morph ) tokenConverted["morph"] = token.morph;   
                return tokenConverted;
            })
        })
   
        const result = {
            alignments: alignmentStashConverted,
            sourceCorpus: sourceCorpusStashConverted,
            targetCorpus: targetCorpusStashConverted,
            opts: this.opts,
        }

        return result;
    }

    /**
     * This is an abstract method which loads from a structure which is JSON-able.
     * @param data - the data to load
     */
    specificLoad(data: any): AbstractWordMapWrapper {
        //opts is handled in the constructor.

        //load saved alignments.
        if( "alignments" in data ){
            const alignmentsStashConverted = data.alignments.map( (alignment :any) => {
                return new Alignment(
                    new Ngram(alignment.s.map( (t: any) => new Token(t) )),
                    new Ngram(alignment.t.map( (t: any) => new Token(t) ))
                );
            });
            this.appendAlignmentMemory( alignmentsStashConverted );
        }


        //load saved corpus.
        if( "sourceCorpus" in data && "targetCorpus" in data ){
            const sourceCorpusStashConverted = data.sourceCorpus.map( (tokens :any) => {
                return tokens.map( (token :any) => {
                    return new Token(token);
                });
            });
            const targetCorpusStashConverted = data.targetCorpus.map( (tokens :any) => {
                return tokens.map( (token :any) => {
                    return new Token(token);
                });
            })
            this.appendCorpusTokens( sourceCorpusStashConverted, targetCorpusStashConverted );
        }

        return this;
    }




    /**
     * This is an abstract method which loads from a structure which is JSON-able.
     * @param data - the data to load
     */
    async async_specificLoad(data: any): Promise<AbstractWordMapWrapper> {
        //opts is handled in the constructor.

        //load saved alignments.
        if( "alignments" in data ){
            const alignmentsStashConverted = data.alignments.map( (alignment :any) => {
                return new Alignment(
                    new Ngram(alignment.s.map( (t: any) => new Token(t) )),
                    new Ngram(alignment.t.map( (t: any) => new Token(t) ))
                );
            });
            this.appendAlignmentMemory( alignmentsStashConverted );
        }


        //load saved corpus.
        if( "sourceCorpus" in data && "targetCorpus" in data ){
            const sourceCorpusStashConverted = data.sourceCorpus.map( (tokens :any) => {
                return tokens.map( (token :any) => {
                    return new Token(token);
                });
            });
            const targetCorpusStashConverted = data.targetCorpus.map( (tokens :any) => {
                return tokens.map( (token :any) => {
                    return new Token(token);
                });
            })
            await this.async_appendCorpusTokens( sourceCorpusStashConverted, targetCorpusStashConverted );
        }

        return this;
    }

    /**
     * Appends alignment memory engine.  This is protected because the add_alignments_2 or add_alignments_4 should be used instead.
     * @param alignments - an alignment or array of alignments
     */
    protected appendAlignmentMemory(alignments: Alignment | Alignment[]): void{
        this.wordMap.appendAlignmentMemory(alignments);

        //Test if alignments is an array or a single alignment.
        if (alignments instanceof Alignment){
            this.alignmentStash.push(alignments);
        }else{
            //push all alignments
            alignments.forEach(align => this.alignmentStash.push(align));
        }
    }

    /**
     * Clears the alignment memory by resetting the alignment stash and recreating the word map.
     * The method empties the alignment stash, initializes a new word map,
     * and repopulates it with the saved source and target corpora.
     *
     * @return {void} Does not return any value.
     */
    clearAlignmentMemory(){
        //clear out the stashed memory
        this.alignmentStash.length = 0;

        //reboot wordmap by recreating it and stuffing it again with the saved corpus.
        this.wordMap = new WordMap(this.opts);
        this.engine = (this.wordMap as any).engine;
        this.wordMap.appendCorpusTokens( this.sourceCorpusStash, this.targetCorpusStash );
    }

    /**
     * Clears all memory and data related to content alignment, source corpus, target corpus,
     * and resets the engine's corpus and alignment memory indices.
     *
     * @return {void} No return value.
     */
    emptyAlignmentMemory(){
        //clear out content memories
        
        this.alignmentStash.length = 0;
        this.sourceCorpusStash.length = 0;
        this.targetCorpusStash.length = 0;
        
        // clear out engine memory - nasty hacking of private properties
        
        // @ts-ignore
        this.engine.corpusIndex = new CorpusIndex();
        // @ts-ignore
        this.engine.alignmentMemoryIndex = new AlignmentMemoryIndex();
    }

    public appendCorpusTokens( sourceTokens: Token[][], targetTokens: Token[][]){
        //Add pos information to the tokens.
        sourceTokens.forEach( tokens => updateTokenLocations(tokens));
        targetTokens.forEach( tokens => updateTokenLocations(tokens));

        this.wordMap.appendCorpusTokens(sourceTokens, targetTokens);
        sourceTokens.forEach( tokens => this.sourceCorpusStash.push(tokens));
        targetTokens.forEach( tokens => this.targetCorpusStash.push(tokens));
    }

    public async async_appendCorpusTokens( sourceTokens: Token[][], targetTokens: Token[][]){
        //Add pos information to the tokens.
        sourceTokens.forEach( tokens => updateTokenLocations(tokens));
        targetTokens.forEach( tokens => updateTokenLocations(tokens));

        const chunkSize = 20;
        let i = 0;
        while (i < sourceTokens.length){
            const chunkSourceTokens = sourceTokens.slice(i, i+chunkSize);
            const chunkTargetTokens = targetTokens.slice(i, i+chunkSize);
            this.wordMap.appendCorpusTokens(chunkSourceTokens, chunkTargetTokens);
            i += chunkSize;
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        sourceTokens.forEach( tokens => this.sourceCorpusStash.push(tokens));
        targetTokens.forEach( tokens => this.targetCorpusStash.push(tokens));
    }

    public appendKeyedCorpusTokens( sourceTokens: {[key:string]: Token[]}, targetTokens: {[key:string]: Token[]}){
        const sourceTokensArray: Token[][] = [];
        const targetTokensArray: Token[][] = [];

        //Pair up the tokens by key in the targetTokensArray.
        Object.keys(targetTokens).forEach( key => {
            if( key in sourceTokens ){
                sourceTokensArray.push(sourceTokens[key]);
                targetTokensArray.push(targetTokens[key]);
            }
        })

        this.appendCorpusTokens( sourceTokensArray, targetTokensArray );
    }
    
    /**
     * Predicts the word alignments between the sentences.
     * @param {string} sourceSentence - a sentence from the source text
     * @param {string} targetSentence - a sentence from the target text
     * @param {number} maxSuggestions - the maximum number of suggestions to return
     * @return {Suggestion[]}
    */
    predict(sourceSentence: string | Token[], targetSentence: string | Token[], maxSuggestions?: number, manuallyAligned: Alignment[] = []): Suggestion[]{
        let sourceTokens = [];
        let targetTokens = [];

        if (typeof sourceSentence === "string") {
            sourceTokens = Lexer.tokenize(sourceSentence);
        } else {
            sourceTokens = sourceSentence;
        }

        if (typeof targetSentence === "string") {
            targetTokens = Lexer.tokenize(targetSentence);
        } else {
            targetTokens = targetSentence;
        }

        const engine_run = (this as any).engine.run(sourceTokens, targetTokens);
        this.score_with_context( engine_run, manuallyAligned );
        const predictions = Engine.sortPredictions(engine_run);
        //return Engine.suggest(predictions, maxSuggestions, (this as any).forceOccurrenceOrder, minConfidence);
        //rolled back to wordmap version 0.6.0 which doesn't have the last two arguments.
        return Engine.suggest(predictions, maxSuggestions/*, (this as any).forceOccurrenceOrder, minConfidence*/);
    }
    

    /**
     * This is overridden by the different models to grade predictions in their own way.
     * @param predictions the predictions which will get a score put in them.
     */
    protected abstract model_score( predictions: Prediction[]): void;


    /**
     * The point of this function is for predictions to be made for verses which are already partially aligned.
     * It is used by the predict method to apply the scores with context of the manual mappings.
     * @param suggestedMappings The mappings which need to be graded
     * @param manualMappings The partial mappings which the user has manually aligned.
     */
    protected score_with_context( suggestedMappings: Prediction[], manualMappings: Alignment[] ){

        //hash the manualMappings so it is easier to look it up.
        const manualMappingSourceToTargetHashes: { [key: string]: string[] } = {};
        const manualMappingTargetToSourceHashes: { [key: string]: string[] } = {};
        for( const manualMapping of manualMappings ){
            addAlignmentToHashes( manualMappingSourceToTargetHashes, manualMappingTargetToSourceHashes, manualMapping );
        }

        const suggestionsWhichNeedModelScore: Prediction[] = [];

        suggestingLoop: for( let suggestedMappingI = 0; suggestedMappingI < suggestedMappings.length; ++suggestedMappingI ){
            const suggestedMapping = suggestedMappings[suggestedMappingI];

            const suggestedMappingSourceToTargetHashes: { [key: string]: string[] } = {};
            const suggestedMappingTargetToSourceHashes: { [key: string]: string[] } = {};
            addAlignmentToHashes( suggestedMappingSourceToTargetHashes, suggestedMappingTargetToSourceHashes, suggestedMapping.alignment );

            //now hash out this suggested mapping.

            //go through every token in both sides of the suggestion,
            //  go through every manual connection which includes this token,
            //    if a connection is found which is not in the original suggestion then the original suggestion is incompatible.
            for( const suggestionSourceTokenHash of Object.keys(suggestedMappingSourceToTargetHashes) ){
                if( suggestionSourceTokenHash in manualMappingSourceToTargetHashes ){
                    const suggestedMappingTargetHashes = suggestedMappingSourceToTargetHashes[suggestionSourceTokenHash];
                    for( const manualMappingTargetTokenHash of manualMappingSourceToTargetHashes[suggestionSourceTokenHash] ){
                        //if this connection doesn't exist in the suggestion, then the suggestion is breaking
                        //connections which the user manually made and is not a valid suggestion.
                        if( !suggestedMappingTargetHashes.includes( manualMappingTargetTokenHash ) ){
                            //This is an invalid suggestion so mark the confidence as 0.
                            suggestedMapping.setScore("confidence", 0 );
                            continue suggestingLoop;
                        }
                    }
                }
            }

            //now do that again the other way around.
            for( const suggestionTargetTokenHash of Object.keys( suggestedMappingTargetToSourceHashes) ){
                if( suggestionTargetTokenHash in manualMappingTargetToSourceHashes ){
                    const suggestedMappingSourceHash = suggestedMappingTargetToSourceHashes[suggestionTargetTokenHash];
                    for( const manualMappingSourceTokenHash of manualMappingTargetToSourceHashes[suggestionTargetTokenHash] ){
                        //if this connection doesn't exist in the suggestion, then then suggestion is breaking
                        //connections which the user manually made and is not a valid suggestion.
                        if( !suggestedMappingSourceHash.includes( manualMappingSourceTokenHash ) ){
                            suggestedMapping.setScore("confidence", 0 );
                            continue suggestingLoop;
                        }
                    }
                }
            }

            //now need to check if this suggestion if defined correct by manual mappings.
            const isConnectionSubsetAndNotNullConnection = (suggestedMappingAToB: { [key: string]: string[] }, manualMappingAToB: { [key: string]: string[] } ): boolean => {
                //Don't go for just an empty set, because then we prioritize null connections.
                if( Object.keys(suggestedMappingAToB).length === 0 ) return false;
                for( const [a,suggestedBList] of Object.entries(suggestedMappingAToB) ){
                    if( !(a in manualMappingAToB) ) return false;
                    const manualBList = manualMappingAToB[a];
                    for( const suggestedB of suggestedBList ){
                        if( !manualBList.includes(suggestedB) ) return false;
                    }
                }
                return true;  
            }

            //Checking if the suggestion is already aligned by the user and setting the confidence to 1 gives an unintended side effect.
            //If there is an ngram and the user has only added one word of the ngram then that gives the single word an unfair advantage.
            //The ngram will get graded and given a score like .7 while the single word will get a score of 1.  So just marking the
            //incompatible connections with zero is good enough to make the engine produce predictions which are compatible with what
            //the user has manually aligned.

            // if( isConnectionSubsetAndNotNullConnection( suggestedMappingTargetToSourceHashes, manualMappingTargetToSourceHashes ) &&
            //     isConnectionSubsetAndNotNullConnection( suggestedMappingSourceToTargetHashes, manualMappingSourceToTargetHashes ) ){
            //     suggestedMapping.setScore("confidence", 1 );
            //     continue suggestingLoop;
            // }


            //ok, if it isn't a manual no or yes, we need to actually use the predict and return the score for that.
            suggestionsWhichNeedModelScore.push( suggestedMapping );
        }

        this.model_score( suggestionsWhichNeedModelScore );
    }
}

export abstract class BoostWordMap extends AbstractWordMapWrapper{

    protected ratio_of_training_data: number = 1; //The ratio of how much data to use so we can thin data.

    /**
     * Saves the model to a json-able structure.
     * @returns {Object}
     */
    save(): { [key: string]: any } {
        const result = {...super.save(),
            "ratio_of_training_data": this.ratio_of_training_data,
        };
        return result;
    }

    /**
     * This is an abstract method which loads from a structure which is JSON-able.
     * @param data - the data to load
     */
    specificLoad(data: any): AbstractWordMapWrapper {
        super.specificLoad(data);
        this.ratio_of_training_data = data["ratio_of_training_data"];
        return this;
    }

    /**
     * This is an abstract method which loads from a structure which is JSON-able.
     * @param data - the data to load
     */
    async async_specificLoad(data: any): Promise<AbstractWordMapWrapper> {
        await super.async_specificLoad(data);
        this.ratio_of_training_data = data["ratio_of_training_data"];
        return this;
    }

    setTrainingRatio(ratio_of_training_data: number) {
        this.ratio_of_training_data = ratio_of_training_data;
    }

    

    collect_boost_training_data( source_text: {[key: string]: Token[]}, 
            target_text: {[key: string]: Token[]}, 
            alignments: {[key: string]: Alignment[] }, 
            ratio_of_incorrect_to_keep: number = .1,
            target_max_alignments: number = 1000 ): [Prediction[], Prediction[]] {
        const correct_predictions: Prediction[] = [];
        const incorrect_predictions: Prediction[] = [];

        //if we have too many alignments it takes too long to spin through them.  So if we have more then target_max_alignments
        //we will decimate it down to that amount
        if( Object.keys( alignments ).length > target_max_alignments ){
            //shuffle the alignments and then take the first target_max_alignments
            const alignmentsAsArray = Object.entries( alignments );
            //randomize using shuffle function
            shuffleArray(alignmentsAsArray);
            
            //take the first target_max_alignments
            alignments = Object.fromEntries(alignmentsAsArray.slice(0,target_max_alignments));
        }

        Object.entries( alignments ).forEach( ([key,verse_alignments], alignment_i) => {
            //collect every prediction
            const every_prediction: Prediction[] = (this as any).engine.run( source_text[key], target_text[key] )

            //iterate through them
            every_prediction.forEach( (prediction: Prediction) => {
                //figure out if the prediction is correct
                //If the prediction is correct, include it, if it isn't randomly include it.
                if( is_correct_prediction( prediction, verse_alignments ) ){
                    correct_predictions.push( prediction );
                }else if( Math.random() < ratio_of_incorrect_to_keep*this.ratio_of_training_data ){
                    incorrect_predictions.push( prediction );
                }
            });

        });

        //return the collected data.
        return [correct_predictions, incorrect_predictions];
    }

    abstract do_boost_training( correct_predictions: Prediction[], incorrect_predictions: Prediction[] ): Promise<void>;


    // I don't know if I should produce the gradient boost training on the data on the same data which is stuffed into its alignment memory.  I suppose I can do some tests to figure this out.

    // So one:
    // 1 Do the alignment training with no verses included.  Then add the verses.
    // 2 Do the alignment training with half of the verses included. Then add the remainder.
    // 3 Do the alignment training with all the verses included already.
    // 4 Add the alignment memory for the first half and collect training data for the second half and then reverse to collect the training data for the first half.

    add_alignments_1( source_text: {[key: string]: Token[]}, target_text: {[key: string]: Token[]}, alignments: {[key: string]: Alignment[] }):Promise<void>{
        // 1 Do the alignment training with no verses included.  Then add the verses.


        const [correct_predictions, incorrect_predictions] = this.collect_boost_training_data( source_text, target_text, alignments );


        Object.entries(alignments).forEach(([verseKey,verse_alignments]) => {
            this.appendAlignmentMemory( verse_alignments );
        });

        return this.do_boost_training(correct_predictions, incorrect_predictions);
    }

    add_alignments_2( source_text: {[key: string]: Token[]}, target_text: {[key: string]: Token[]}, alignments: {[key: string]: Alignment[] }):Promise<void>{
        // 2 Do the alignment training with half of the verses included. Then add the remainder.
        const alignments_split_a = Object.fromEntries(Object.entries(alignments).filter((_, i) => i % 2 === 0));
        const alignments_split_b = Object.fromEntries(Object.entries(alignments).filter((_, i) => i % 2 !== 0));



        Object.entries(alignments_split_a).forEach(([verseKey,verse_alignments]) => this.appendAlignmentMemory( verse_alignments ) );

        const [correct_predictions, incorrect_predictions] = this.collect_boost_training_data( source_text, target_text, alignments_split_b );

        Object.entries(alignments_split_b).forEach(([verseKey,verse_alignments]) => this.appendAlignmentMemory( verse_alignments ) );

        return this.do_boost_training(correct_predictions, incorrect_predictions);
    }

    add_alignments_3( source_text: {[key: string]: Token[]}, target_text: {[key: string]: Token[]}, alignments: {[key: string]: Alignment[] }):Promise<void>{
        // 3 Do the alignment training with all the verses included already.

        Object.entries(alignments).forEach(([verseKey,verse_alignments]) => {
            this.appendAlignmentMemory( verse_alignments );
        });


        const [correct_predictions, incorrect_predictions] = this.collect_boost_training_data( source_text, target_text, alignments );

        return this.do_boost_training(correct_predictions, incorrect_predictions);
    
    }

    add_alignments_4( source_text: {[key: string]: Token[]}, target_text: {[key: string]: Token[]}, alignments: {[key: string]: Alignment[] }):Promise<void>{
        // 4 Add the alignment memory for the first half and collect training data for the second half and then reverse to collect the training data for the first half.

        //split the alignment data into two groups.
        const alignments_split_a = Object.fromEntries(Object.entries(alignments).filter((_, i) => i % 2 === 0));
        const alignments_split_b = Object.fromEntries(Object.entries(alignments).filter((_, i) => i % 2 !== 0));

        //Add a and train on b
        Object.entries(alignments_split_a).forEach(([verseKey,verse_alignments]) => this.appendAlignmentMemory( verse_alignments ) );
        const [correct_predictions_1, incorrect_predictions_1] = this.collect_boost_training_data( source_text, target_text, alignments_split_b );

        this.clearAlignmentMemory()

        //now add b and train on a
        Object.entries(alignments_split_b).forEach(([verseKey,verse_alignments]) => this.appendAlignmentMemory( verse_alignments ) );
        const [correct_predictions_2, incorrect_predictions_2] = this.collect_boost_training_data( source_text, target_text, alignments_split_a );

        //now train the model on both of them.
        const correct_predictions = correct_predictions_1.concat( correct_predictions_2);
        const incorrect_predictions = incorrect_predictions_1.concat( incorrect_predictions_2 );

        //Add a back in for inference time.
        Object.entries(alignments_split_a).forEach(([verseKey,verse_alignments]) => this.appendAlignmentMemory( verse_alignments ) );

        return this.do_boost_training(correct_predictions, incorrect_predictions);
    }
}

//The point of this class is to make a way of interacting with WordMap
//which uses the same extended interface of the CatBoostWordMap interface.
export class PlaneWordMap extends AbstractWordMapWrapper{
    setTrainingRatio(ratio_of_training_data: number) { /*do nothing.*/ }

    /**
     * Saves the model to a json-able structure.
     * @returns {Object}
     */
    save(): { [key: string]: any } {
        const result = {...super.save(),
            "classType": "PlaneWordMap"
        };
        return result;
    }

    add_alignments_1( source_text: {[key: string]: Token[]}, target_text: {[key: string]: Token[]}, alignments: {[key: string]: Alignment[] }):Promise<void>{
        // In "plane" the different ways of adding are all the same.
        Object.entries(alignments).forEach(([verseKey,verse_alignments]) => this.appendAlignmentMemory( verse_alignments ) );
        //return a thin promise just so that we have the same api as the other.
        return new Promise<void>(resolve => resolve());
    }
    add_alignments_2( source_text: {[key: string]: Token[]}, target_text: {[key: string]: Token[]}, alignments: {[key: string]: Alignment[] }):Promise<void>{
        return this.add_alignments_1( source_text, target_text, alignments );
    }
    add_alignments_3( source_text: {[key: string]: Token[]}, target_text: {[key: string]: Token[]}, alignments: {[key: string]: Alignment[] }):Promise<void>{
        return this.add_alignments_1( source_text, target_text, alignments );
    }
    add_alignments_4( source_text: {[key: string]: Token[]}, target_text: {[key: string]: Token[]}, alignments: {[key: string]: Alignment[] }):Promise<void>{
        return this.add_alignments_1( source_text, target_text, alignments );
    }

    do_boost_training( correct_predictions: Prediction[], incorrect_predictions: Prediction[] ): Promise<void>{
        //no boost type training in the plane word map.
        return Promise.resolve();
    }


    protected model_score(predictions: Prediction[]): void {
        this.engine.score(predictions);
    }
}






export const morph_code_catboost_cat_feature_order : string[] = [
    "src_morph_0",
    "src_morph_1",
    "src_morph_2",
    "src_morph_3",
    "src_morph_4",
    "src_morph_5",
    "src_morph_6",
    "src_morph_7",
];

/**
 * Generates a feature dictionary from a code prediction.
 *
 * @param {Prediction} prediction - The code prediction to generate the feature dictionary from.
 * @return {{[key:string]:(number|string)}} - The generated feature dictionary.
 */
export function morph_code_prediction_to_feature_dict( prediction: Prediction ): {[key:string]:(number|string)}{
    const result: {[key: string]:number|string} = {};
    const scores = prediction.getScores();
    catboost_feature_order.forEach( key => {
        result[key] = scores[key] ?? 0;
    });

    prediction.alignment.sourceNgram.getTokens().forEach( (token:Token) => {
        token.morph.split(",").forEach( (morph_piece,morph_index) =>{
            const categorical_key = `src_morph_${morph_index}`;
            if( morph_code_catboost_cat_feature_order.includes( categorical_key) ){
                if( !(categorical_key in result) ){
                    result[categorical_key] = ''
                }
    
                result[categorical_key] += morph_piece;
            }
        });
    });
    morph_code_catboost_cat_feature_order.forEach( key => {
        if( !(key in result ) ){
            result[key] = "";
        }
    })
    return result;
}




function jlboost_prediction_to_feature_dict( prediction: Prediction ): {[key:string]:number}{
    const result: {[key: string]:number} = {};
    const scores = prediction.getScores();
    catboost_feature_order.forEach( key => {
        result[key] = scores[key] ?? 0;
    });
    return result;
}

export class JLBoostWordMap extends BoostWordMap{
    protected jlboost_model: JLBoost | null = null;


    /**
     * Saves the model to a json-able structure.
     * @returns {Object}
     */
    save(): { [key: string]: any } {
        const result = {...super.save(),
            "jlboost_model": this.jlboost_model?.save(),
            "classType": "JLBoostWordMap"
        };
        return result;
    }


    /**
     * This is an abstract method which loads from a structure which is JSON-able.
     * @param data - the data to load
     */
    specificLoad(data: any): AbstractWordMapWrapper {
        super.specificLoad(data);
        this.jlboost_model = JLBoost.load(data.jlboost_model);
        return this;
    }

    /**
     * This is an abstract method which loads from a structure which is JSON-able.
     * @param data - the data to load
     */
    async async_specificLoad(data: any): Promise<AbstractWordMapWrapper> {
        await super.async_specificLoad(data);
        this.jlboost_model = JLBoost.load(data.jlboost_model);
        return this;
    }

    model_score( predictions: Prediction[]): void{ 
        for( let prediction_i = 0; prediction_i < predictions.length; ++prediction_i ){
            const numerical_features = jlboost_prediction_to_feature_dict(predictions[prediction_i]);
            const confidence = this.jlboost_model.predict_single( numerical_features );
            predictions[prediction_i].setScore("confidence", confidence);
        }
    }

    do_boost_training( correct_predictions: Prediction[], incorrect_predictions: Prediction[] ): Promise<void>{
        //first collect the data to train on.
        const prediction_to_dict = function( prediction: Prediction, is_correct: boolean ): {[key: string]: number}{
            const result = {};
            catboost_feature_order.forEach( (feature_name) => {
                try {
                    result[feature_name] = prediction.getScore(feature_name) ?? 0;
                } catch (error) {
                    if (error.message.startsWith("Unknown score key")) {
                        result[feature_name] = 0;
                    } else {
                        throw error; // re-throw the error if it's not the expected error type
                    }
                }
            });
            result["output"] = is_correct?1:0;
            return result;
        };


        const training_data = correct_predictions.map( p => prediction_to_dict(p,true) )
            .concat( incorrect_predictions.map( p => prediction_to_dict(p,false) ) );

        

        this.jlboost_model = new JLBoost({learning_rate: this.opts.learning_rate });

        return new Promise<void>((resolve) => {
            this.jlboost_model.train({
                xy_data:training_data,
                y_index:"output",
                n_steps:this.opts.train_steps,
                tree_depth:this.opts.tree_depth,
                talk: (this.opts.verbose_training !== undefined) ? this.opts.verbose_training : true,
                progress_callback: this.opts.progress_callback,
            });
            resolve();
        });
    }
}


export class MorphJLBoostWordMap extends BoostWordMap{
    protected jlboost_model: JLBoost | null = null;

    /**
     * Saves the model to a json-able structure.
     * @returns {Object}
     */
    save(): { [key: string]: any } {
        const result = {
            ...super.save(),
            "jlboost_model": this.jlboost_model?.save(),
            "classType": "MorphJLBoostWordMap"
        };
        return result;
    }

    /**
     * This is an abstract method which loads from a structure which is JSON-able.
     * @param data - the data to load
     */
    specificLoad(data: any): AbstractWordMapWrapper {
        super.specificLoad(data);
        this.jlboost_model = JLBoost.load(data.jlboost_model);
        return this;
    }

    /**
     * This is an abstract method which loads from a structure which is JSON-able.
     * @param data - the data to load
     */
    async async_specificLoad(data: any): Promise<AbstractWordMapWrapper> {
        await super.async_specificLoad(data);
        this.jlboost_model = JLBoost.load(data.jlboost_model);
        return this;
    }


    model_score( predictions: Prediction[]):void{ 
        for( let prediction_i = 0; prediction_i < predictions.length; ++prediction_i ){
            const numerical_features = morph_code_prediction_to_feature_dict(predictions[prediction_i]);
            const confidence = this.jlboost_model.predict_single( numerical_features );
            predictions[prediction_i].setScore("confidence", confidence);
        }
    }

    do_boost_training( correct_predictions: Prediction[], incorrect_predictions: Prediction[] ): Promise<void>{
        //first collect the data to train on.
        const prediction_to_dict = function( prediction: Prediction, is_correct: boolean ): {[key: string]: number|string}{
            const result = morph_code_prediction_to_feature_dict(prediction);
            result["output"] = is_correct?1:0;
            return result;
        };


        const training_data = correct_predictions.map( p => prediction_to_dict(p,true) )
            .concat( incorrect_predictions.map( p => prediction_to_dict(p,false) ) );

        
            
        this.jlboost_model = new JLBoost({ categorical_catagories: morph_code_catboost_cat_feature_order, learning_rate: this.opts.learning_rate });

        return new Promise<void>((resolve) => {
            this.jlboost_model.train({
                xy_data:training_data,
                y_index:"output",
                n_steps:this.opts.train_steps,
                tree_depth:this.opts.tree_depth,
                talk: (this.opts.verbose_training !== undefined) ? this.opts.verbose_training : true,
                progress_callback: this.opts.progress_callback,
            });
            resolve();
        });
    }
}
