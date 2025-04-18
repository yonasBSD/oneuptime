require("ts-loader");
require("file-loader");
require("style-loader");
require("css-loader");
require("sass-loader");
const path = require("path");
const webpack = require("webpack");
const dotenv = require("dotenv");
const BundleAnalyzerPlugin =
  require("webpack-bundle-analyzer").BundleAnalyzerPlugin;
  const setupMiddleware = require('Common/UI/webpack-middleware');

const readEnvFile = (pathToFile) => {
  const parsed = dotenv.config({ path: pathToFile }).parsed;

  const env = {};

  for (const key in parsed) {
    env[key] = JSON.stringify(parsed[key]);
  }

  return env;
};

module.exports = {
  entry: "./src/Index.tsx",
  mode: "development",
  output: {
    filename: "bundle.js",
    path: path.resolve(__dirname, "public", "dist"),
    publicPath: "/dashboard/dist/",
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json", ".css", ".scss"],
    alias: {
      react: path.resolve("./node_modules/react"),
    },
  },
  externals: {
    "react-native-sqlite-storage": "react-native-sqlite-storage",
  },
  plugins: [
    new webpack.DefinePlugin({
      process: {
        env: {
          ...readEnvFile("/usr/src/app/dev-env/.env"),
        },
      },
    }),
    process.env.analyze === "true" ? new BundleAnalyzerPlugin() : () => {},
  ],
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        loader: "ts-loader",
      },
      {
        test: /\.s[ac]ss$/i,
        use: ["style-loader", "css-loader", "sass-loader"],
      },
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
      {
        test: /\.(jpe?g|png|gif|svg)$/i,
        loader: "file-loader",
      },
    ],
  },
  devServer: {
    historyApiFallback: true,
    devMiddleware: {
      writeToDisk: true,
    },
    allowedHosts: "all",
    setupMiddlewares: setupMiddleware('dashboard')
  },
  devtool: "eval-source-map",
};
