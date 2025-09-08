let range = (n: number, offset: number) =>
  Array.from(Array(n).keys()).map((n) => n + offset);

abstract class BranchOrLeaf{
    abstract predict_single(data: {[key: string]:number|string}, categorical_categories: string[]): number;

    abstract predict(xy_data: {[key: string]: number|string}[], categorical_categories: string[]): number[];

    abstract save(): {[key:string]:any};
}

export class TreeLeaf extends BranchOrLeaf{
    private average: number;

    constructor(average: number) {
        super();
        this.average = average;
    }

    predict_single(data: {[key: string]:number|string}, categorical_categories: string[]): number {
        return this.average;
    }

    predict(xy_data: {[key: string]: number|string}[], categorical_categories: string[]): number[] {
        return [...Array(xy_data.length)].map(() => this.average);
    }

    save(): {[key:string]:any}{
        return {'average': this.average};
    }

    /**
    * This is a static function which loads from a structure which is JSON-able.
    */
    static load(data: {[key:string]:any}): TreeLeaf{
        return new TreeLeaf(data['average']);
    }
}

const MIDDLE_SPLIT_FAVOR: number = 0.25;

interface TreeBranch__random_tree__NamedParameters{
    xy_data: {[key: string]: number|string}[], 
    num_levels: number,
    y_index: string,
    ignored_categories: string[],
    categorical_categories: string[],
}

export class TreeBranch extends BranchOrLeaf {
    private left_side: BranchOrLeaf | null;
    private right_side: BranchOrLeaf | null;
    public feature_index: string | null;
    public split_value: any | null;

    constructor() {
        super();
        this.left_side = null;
        this.right_side = null;
        this.feature_index = null;
        this.split_value = null;
    }

    /**
     * Saves the current state of the object as a key-value pair object.
     *
     * @return {{[key:string]:any}} The key-value pair object representing the state of the object.
     */
    save(): {[key:string]:any}{
        const result: {[key:string]:any} = {};

        result['feature_index'] = this.feature_index;
        result['split_value'] = this.split_value;
        result['left_side'] = this.left_side.save();
        result['right_side'] = this.right_side.save();

        return result;
    }

    /**
     * This is a static function which loads from a structure which is JSON-able.
     */
    static load( data: {[key:string]:any}): BranchOrLeaf {
        //first determine if what is passed in is a leaf or a branch.
        if( data['left_side'] && data['right_side']){
            const result = new TreeBranch();
            result.feature_index = data['feature_index'];
            result.split_value = data['split_value'];
            result.left_side = TreeBranch.load(data['left_side']);
            result.right_side = TreeBranch.load(data['right_side']);
            return result;
        }else{
            return TreeLeaf.load(data);
        }
    }

    predict_single( data: {[key: string]:number|string}, categorical_categories: string[]): number {
        let follow_left_side = false;

        //see if we are a categorical split or a numerical split.
        if( categorical_categories.includes(this.feature_index) ){
            follow_left_side = data[this.feature_index] === this.split_value;
        }else{
            follow_left_side = (!isNaN(data[this.feature_index] as number)?data[this.feature_index]:-1) <= this.split_value;
        }
        return (follow_left_side)?
                    this.left_side.predict_single(data,categorical_categories):
                    this.right_side.predict_single(data,categorical_categories);
    }

    predict(xy_data: {[key: string]: number|string}[], categorical_categories: string[]): number[] {
        return xy_data.map( row => this.predict_single(row,categorical_categories) );
    }

    random_tree({
        xy_data,
        num_levels,
        y_index,
        ignored_categories,
        categorical_categories,
    }:TreeBranch__random_tree__NamedParameters ): BranchOrLeaf {
        //assuming the keys on the first object are representative.
        const categories = Object.keys(xy_data[0]).filter(
            (category) => category !== y_index && !ignored_categories.includes(category)
        );


        let xy_data_sorted: {[key: string]: number|string}[] = [];
        let first_of_right_hand: number = 0;
        const length = xy_data.length;

        //check if there are any categories left
        if( categories.length > 0 ){

            //Randomly select a category
            const randomCategoryIndex = Math.floor(Math.random() * categories.length);
            this.feature_index = categories[randomCategoryIndex];


            //determine if this is a categorical category or not.
            if( categorical_categories.includes(this.feature_index) ){
                const available_options : string[] = xy_data.reduce((choices,choice) => choices.includes(choice[this.feature_index]) ? choices : [...choices,choice[this.feature_index]], [] );
                const selected_option_i : number = Math.floor(Math.random()*available_options.length);
                this.split_value = available_options[selected_option_i];

                //we now need to sort so that the selected option is at the front and everything else is not.
                const haves : {[key: string]:number|string}[] = [];
                const have_nots : {[key: string]:number|string}[] = [];
                xy_data.forEach( (sample) => {
                    if( sample[this.feature_index] === this.split_value ){
                        haves.push( sample );
                    }else{
                        have_nots.push( sample );
                    }
                })

                xy_data_sorted = haves.concat(have_nots);
                first_of_right_hand = haves.length;
            }else{
                first_of_right_hand = Math.min(
                    Math.max(Math.floor(Math.random() * length), 1),
                    length - 1
                );

                // Sort the section by the selected feature index
                xy_data_sorted = xy_data.slice();
                xy_data_sorted.sort( (a,b) => (!isNaN(a[this.feature_index] as number)?(a[this.feature_index] as number):-1)-(!isNaN(b[this.feature_index] as number)?(b[this.feature_index] as number):-1));


                //determine our split value from the randomly hit split location.
                this.split_value =
                    0.5 *
                    ((!isNaN(xy_data_sorted[first_of_right_hand - 1][this.feature_index] as number)?(xy_data_sorted[first_of_right_hand - 1][this.feature_index] as number):-1) +
                    (!isNaN(xy_data_sorted[first_of_right_hand][this.feature_index] as number)?(xy_data_sorted[first_of_right_hand][this.feature_index] as number):-1));

            }
        }

        //check for a degenerate split.
        let result : BranchOrLeaf = this;
        if(first_of_right_hand == 0 ||first_of_right_hand == length){
            //if we have depth left just try growing a new branch.
            if (num_levels > 1){
                //we set our return result to the new random_tree which excludes ourselves (this)
                //from the resulting tree, but we set the left and right side to the result as
                //well just to get rid of null pointers running around.
                result = this.left_side = this.right_side = new TreeBranch().random_tree({
                    ignored_categories: [],
                    xy_data:xy_data_sorted.slice(0,length),
                    num_levels: num_levels - 1,
                    y_index,
                    categorical_categories,
                });
            }else{
                //otherwise just grow a leaf.
                result = this.left_side = this.right_side = new TreeLeaf(
                    //compute average of y_index of right hand side.
                    (xy_data_sorted.slice( 0, length ).map( row => row[y_index] ) as number[]).reduce((sum,current) => sum+current,0)/length
                );
            }
        }else{
            if (num_levels > 1) {
                if (first_of_right_hand > 1) {
                    this.left_side = new TreeBranch().random_tree({
                        ignored_categories: [],
                        xy_data:xy_data_sorted.slice(0,first_of_right_hand),
                        num_levels: num_levels - 1,
                        y_index,
                        categorical_categories,
                    });
                } else {
                    this.left_side = new TreeLeaf(
                        //compute average of y_index of left hand side.
                        (xy_data_sorted.slice( 0, first_of_right_hand ).map( row => row[y_index] ) as number[]).reduce((sum,current) => sum+current,0)/length
                    );
                }

                if (length - first_of_right_hand > 1) {
                    this.right_side = new TreeBranch().random_tree({
                        ignored_categories: [],
                        xy_data:xy_data_sorted.slice(first_of_right_hand,length),
                        num_levels: num_levels - 1,
                        y_index,
                        categorical_categories,
                    });
                } else {
                    this.right_side = new TreeLeaf(
                        //compute average of y_index of right hand side.
                        (xy_data_sorted.slice( first_of_right_hand, length ).map( row => row[y_index] ) as number[]).reduce((sum,current) => sum+current,0)/length
                    );
                }
            } else {
                this.left_side = new TreeLeaf(
                    //compute average of y_index of left hand side.
                    (xy_data_sorted.slice( 0, first_of_right_hand ).map( row => row[y_index] ) as number[]).reduce((sum,current) => sum+current,0)/length
                );
                this.right_side = new TreeLeaf(
                    //compute average of y_index of right hand side.
                    (xy_data_sorted.slice( first_of_right_hand, length ).map( row => row[y_index] ) as number[]).reduce((sum,current) => sum+current,0)/length
                );
            }
        }

        return result;
    }
}

interface JLBoost__train__NamedParameters {
    xy_data: {[key: string]: number|string}[], // Replace 'any' with the appropriate type for xy_data
    y_index: string,
    n_steps: number,
    tree_depth: number,
    talk: boolean,
    progress_callback?: (step: number, trainingSteps, current_loss: number) => void,
}
interface JLBoost__constructor__NamedParameters{
    learning_rate?: number,
    categorical_catagories?: string[],
}
export class JLBoost {
    trees: TreeBranch[];
    learning_rate: number;
    categorical_categories: string[];

    constructor( {learning_rate = 0.07, categorical_catagories = []}: JLBoost__constructor__NamedParameters ){
        this.trees = [];
        this.learning_rate = learning_rate;
        this.categorical_categories = categorical_catagories;
    }

    /**
     * This function saves the state of JLBoost to a structure which is JSON-able
     * and can be loaded later using restore.
     */
    save(){
        return {
            trees: this.trees.map((tree) => {
                return tree.save()
            }),
            learning_rate: this.learning_rate,
            categorical_categories: this.categorical_categories,
        };
    }

    /**
     * This is a static function which loads from a structure which is JSON-able.
     */
    static load( data: {[key:string]:any}): JLBoost {
        const result: JLBoost = new JLBoost({ learning_rate: parseFloat(data.learning_rate), categorical_catagories: (data.categorical_categories as string[]) });
        result.trees = data.trees.map((tree) => {
            return TreeBranch.load(tree)
        });
        return result;
    }

    predict(xy_data: {[key: string]: number|string}[] ): any {
        let output: any = Array(xy_data.length).fill(0);

        for (const tree of this.trees) {
            const treePrediction = tree.predict(xy_data,this.categorical_categories);
            output = output.map((value: number, index: number) => {
                return value + treePrediction[index] * this.learning_rate;
            });
        }
        return output;
    }

    predict_single( data: {[key: string]:number|string} ): number{
        let output: number = 0;

        for( const tree of this.trees){
            const treePrediction = tree.predict_single( data, this.categorical_categories );
            output += treePrediction;
        }

        return output * this.learning_rate;
    }


    train({
        xy_data,
        y_index = 'y',
        n_steps = 1000,
        tree_depth = 2,
        talk = true,
        progress_callback = null
    }: JLBoost__train__NamedParameters ): JLBoost {
        let current_output = this.predict(xy_data);

        //Drop all features which don't do anything.
        let featuresToDrop : string[] = [];
        for( const feature of Object.keys(xy_data[0]) ){
            //see if this is a categorical feature or a numerical feature.
            if( this.categorical_categories.includes(feature) ){
                const features_found: string[] = [];
                for( const value of xy_data ){
                    if( !features_found.includes(value[feature] as string)){
                        features_found.push(value[feature] as string);
                    }
                    if( features_found.length > 1 ) break;
                }

                if( features_found.length < 2 ){
                    featuresToDrop.push( feature );
                    if( talk ){
                        console.log( `Dropping constant categorical feature ${feature}` );
                    }
                }
            }else{
                const max_value = xy_data.reduce((max,current) => {
                    return (current[feature] as number) > max ? current[feature] : max;
                }, Number.MIN_SAFE_INTEGER);
                const min_value = xy_data.reduce((min,current) => {
                    return (current[feature] as number) < min ? current[feature] : min;
                }, Number.MAX_SAFE_INTEGER);

                if( max_value == min_value ){
                    featuresToDrop.push( feature );
                    if(talk){
                        console.log( `Dropping constant feature ${feature}` );
                    }
                }
            }
        }
        xy_data = xy_data.map( row => Object.fromEntries(Object.entries(row).filter(([feature,value]) => !featuresToDrop.includes(feature))));

        let ignored_categories: string[] = [];
        let last_loss: number | null = null;

        for (let n = 0; n < n_steps; n++) {

            const adjusted_data = xy_data.map( (row, row_n) => {
                return {
                    ...row,
                    [y_index]: (row[y_index] as number) - current_output[row_n]
                }
            })

            const new_tree = new TreeBranch();
            new_tree.random_tree({
                num_levels: tree_depth,
                ignored_categories: ignored_categories,
                xy_data: adjusted_data,
                y_index: y_index,
                categorical_categories: this.categorical_categories,
            });

            const new_tree_output = new_tree.predict( xy_data, this.categorical_categories );
            const new_output: number[] = current_output.map((value: number, index: number) => {
                return value + new_tree_output[index] * this.learning_rate;
            });

            //const new_loss = Math.stdDev(xy_data[y_index] - new_output);
            const error : number[] = xy_data.map( (row,row_n) => new_output[row_n] - (row[y_index] as number) );
            const error_sum : number = error.reduce( (sum,current) => sum+current, 0 );
            const error_mean = error_sum/error.length;
            const error_dist_squared = error.map( value => (value-error_mean)*(value-error_mean) ).reduce( (sum,current) => sum+current, 0 );
            const new_loss = Math.sqrt( error_dist_squared/error.length );

            ignored_categories = [new_tree.feature_index];

            if (last_loss === null || new_loss < last_loss) {
                this.trees.push(new_tree);
                last_loss = new_loss;
                current_output = new_output;

                if (talk) {
                    console.log(
                        `Step ${n}: Output  ${new_loss}  split on ${new_tree.feature_index} at ${new_tree.split_value}`
                    );
                }
                progress_callback?.( n, n_steps, new_loss );
            } else {
                if (talk) {
                    console.log(
                        `Step ${n}: Output [${new_loss}] split on ${new_tree.feature_index} at ${new_tree.split_value} --rejected`
                    );
                }
                progress_callback?.( n, n_steps, new_loss );
            }
        }
        return this;
    }
}

//https://stackoverflow.com/questions/521295/seeding-the-random-number-generator-in-javascript
function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

// if (require.main === module) {
//     //seed random for the test.
//     Math.random = mulberry32(0);

//     for( let i = 0; i < 5; ++i ){
//         console.log(Math.random());
//     }


//     //Do some tests of the module

//     const test_data = [
//         { 'gender':'m', 'age':2,  'y':0 },
//         { 'gender':'f', 'age':3,  'y':0 },
//         { 'gender':'m', 'age':6,  'y':0 },
//         { 'gender':'f', 'age':7,  'y':0 },
//         { 'gender':'f', 'age':9,  'y':0 },
//         { 'gender':'m', 'age':12, 'y':.1 },
//         { 'gender':'m', 'age':15, 'y':.3 },
//         { 'gender':'f', 'age':16, 'y':9 },
//         { 'gender':'m', 'age':16, 'y':1 },
//         { 'gender':'m', 'age':18, 'y':10 },
//         { 'gender':'f', 'age':18, 'y':8 },
//         { 'gender':'m', 'age':20, 'y':7 },
//         { 'gender':'m', 'age':21, 'y':7 },
//         { 'gender':'m', 'age':23, 'y':7 },
//         { 'gender':'f', 'age':26, 'y':4 },
//         { 'gender':'m', 'age':27, 'y':4 },
//         { 'gender':'f', 'age':29, 'y':2 },
//         { 'gender':'f', 'age':30, 'y':1 },
//         { 'gender':'m', 'age':40, 'y':1 },
//         { 'gender':'m', 'age':100, 'y':10 },
//         { 'gender':'f', 'age':100, 'y':9 },
//     ];

//     const model = new JLBoost( {categorical_catagories:['gender'] });

//     // const test_data = [
//     //     { 'gender':0, 'age':2,  'y':0 },
//     //     { 'gender':1, 'age':3,  'y':0 },
//     //     { 'gender':0, 'age':6,  'y':0 },
//     //     { 'gender':1, 'age':7,  'y':0 },
//     //     { 'gender':1, 'age':9,  'y':0 },
//     //     { 'gender':0, 'age':12, 'y':.1 },
//     //     { 'gender':0, 'age':15, 'y':.3 },
//     //     { 'gender':1, 'age':16, 'y':9 },
//     //     { 'gender':0, 'age':16, 'y':1 },
//     //     { 'gender':0, 'age':18, 'y':10 },
//     //     { 'gender':1, 'age':18, 'y':8 },
//     //     { 'gender':0, 'age':20, 'y':7 },
//     //     { 'gender':0, 'age':21, 'y':7 },
//     //     { 'gender':0, 'age':23, 'y':7 },
//     //     { 'gender':1, 'age':26, 'y':4 },
//     //     { 'gender':0, 'age':27, 'y':4 },
//     //     { 'gender':1, 'age':29, 'y':2 },
//     //     { 'gender':1, 'age':30, 'y':1 },
//     //     { 'gender':0, 'age':40, 'y':1 },
//     //     { 'gender':0, 'age':100, 'y':10 },
//     //     { 'gender':1, 'age':100, 'y':9 },
//     // ];

//     // const model = new JLBoost( {});

//     model.train( {xy_data: test_data, y_index:'y', n_steps:1000, tree_depth:7, talk:true })

//     const model_results = model.predict( test_data );


//     const with_prediction = test_data.map( (row,row_n) => {
//         return {
//             ...row,
//             prediction: model_results[row_n],
//             diff: model_results[row_n]-row['y']
//         }
//     });

//     console.table( with_prediction );

//     //print first tree to screen.
//     const first_tree_as_dict = model.trees[0].save();
//     console.log(JSON.stringify(first_tree_as_dict, null,2));
// }