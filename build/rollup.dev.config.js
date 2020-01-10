import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import ts from "@wessberg/rollup-plugin-ts";
import babel from 'rollup-plugin-babel';

const prod = process.env.NODE_ENV === 'production';

export default {
  input: './lib/index.ts',
  output: [
    {
      file: 'dist/pulse.js',
      name: 'Pulse',
      format: 'umd',
      freeze: false,
      sourcemap: true
    },
    {
      file: 'dist/pulse.cjs.js',
      name: 'Pulse',
      format: 'cjs',
      freeze: false,
      sourcemap: true
    },
    {
      file: 'dist/pulse.esm.js',
      name: 'Pulse',
      format: 'esm',
      sourcemap: true
    }
  ],
  plugins: [
    ts({
      tsconfig: 'tsconfig.json',
      browserslist: false
    }),
    nodeResolve({
      browser: true
    }),
    commonjs({ extensions: ['.js', '.ts'] }),
    babel({
      runtimeHelpers: true,
      exclude: 'node_modules/**'
    }),
    replace({
      'process.env.NODE_ENV': JSON.stringify(
        prod ? 'production' : 'development'
      )
    })
  ]
};
