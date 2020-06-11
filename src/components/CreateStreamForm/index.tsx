import React, { useCallback, useEffect, useState } from "react";
import { Contract } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";
import { InfuraProvider } from "@ethersproject/providers";
import { parseEther } from "@ethersproject/units";
import { BigNumberInput } from "big-number-input";
import { Button, Select, Text, TextField, Loader } from "@gnosis.pm/safe-react-components";
import { SafeInfo, SdkInstance } from "@gnosis.pm/safe-apps-sdk";

import DurationInput, { Duration } from "./DurationInput";
import erc20Abi from "../../abis/erc20";
import createEthStreamTxs from "../../utils/transactions/createEthStream";
import createStreamTxs from "../../utils/transactions/createStream";

import { ButtonContainer, SelectContainer } from "../../theme/components";
import { TokenItem, getTokenList } from "../../config/tokens";
import { Transaction } from "../../typings";
import { bigNumberToHumanFormat } from "../../utils";

export type Props = {
  appsSdk: SdkInstance;
  safeInfo?: SafeInfo;
};

function CreateStreamForm({ appsSdk, safeInfo }: Props) {
  /** State Variables **/

  const [amountError, setAmountError] = useState<string | undefined>();
  const [duration, setDuration] = useState<Duration>({
    label: "Duration",
    totalSeconds: BigNumber.from(0),
  });
  const [recipient, setRecipient] = useState<string>("");
  const [selectedToken, setSelectedToken] = useState<TokenItem>();
  const [streamAmount, setStreamAmount] = useState<string>("");
  const [tokenBalance, setTokenBalance] = useState<string>("0");
  const [tokenInstance, setTokenInstance] = useState<Contract>();
  const [tokenList, setTokenList] = useState<TokenItem[]>();

  /** Callbacks **/

  const humanTokenBalance = useCallback((): string => {
    return selectedToken ? bigNumberToHumanFormat(tokenBalance, selectedToken.decimals) : "";
  }, [selectedToken, tokenBalance]);

  const validateAmountValue = useCallback((): boolean => {
    setAmountError(undefined);

    const currentValueBN: BigNumber = BigNumber.from(streamAmount);
    const comparisonValueBN: BigNumber = BigNumber.from(tokenBalance);

    if (currentValueBN.gt(comparisonValueBN)) {
      setAmountError(`You only have ${humanTokenBalance()} ${selectedToken && selectedToken.label} in your Safe`);
      return false;
    }

    return true;
  }, [humanTokenBalance, selectedToken, streamAmount, tokenBalance]);

  const createStream = useCallback((): void => {
    /* We call in this way to ensure all errors are displayed to user */
    const amountValid = validateAmountValue();
    if (!safeInfo || !selectedToken || !amountValid || !duration || !duration?.label || !duration?.totalSeconds) {
      return;
    }

    /* TODO: Stream initiation must be approved by other owners within an hour */
    const totalSeconds: number = duration.totalSeconds.toNumber();
    const currentUnix: number = Math.floor(new Date().getTime() / 1000);
    const startTime: BigNumber = BigNumber.from(currentUnix).add(3600);
    const stopTime: BigNumber = startTime.add(totalSeconds);

    const bnStreamAmount = BigNumber.from(streamAmount);
    const safeStreamAmount = bnStreamAmount.sub(bnStreamAmount.mod(totalSeconds));

    let txs: Transaction[];
    if (selectedToken.id === "ETH") {
      /* If streaming ETH we need to wrap it first. */
      txs = createEthStreamTxs(
        safeInfo.network,
        recipient,
        safeStreamAmount.toString(),
        startTime.toString(),
        stopTime.toString(),
      );
    } else {
      txs = createStreamTxs(
        safeInfo.network,
        recipient,
        safeStreamAmount.toString(),
        tokenInstance?.address || "",
        startTime.toString(),
        stopTime.toString(),
      );
    }

    appsSdk.sendTransactions(txs);

    setStreamAmount("");
    setRecipient("");
  }, [appsSdk, duration, recipient, safeInfo, selectedToken, streamAmount, tokenInstance, validateAmountValue]);

  const isButtonDisabled = useCallback((): boolean => {
    return (
      streamAmount.length === 0 ||
      streamAmount === "0" ||
      Boolean(amountError) ||
      !duration.totalSeconds ||
      duration.totalSeconds.isZero()
    );
  }, [amountError, duration, streamAmount]);

  const onSelectItem = useCallback(
    (id: string): void => {
      if (!tokenList) {
        return;
      }
      const newSelectedToken = tokenList.find(t => {
        return t.id === id;
      });
      if (!newSelectedToken) {
        return;
      }
      setSelectedToken(newSelectedToken);
    },
    [setSelectedToken, tokenList],
  );

  const onAmountChange = useCallback((value: string): void => {
    setAmountError(undefined);
    setStreamAmount(value);
  }, []);

  const onUpdateDuration = useCallback(
    (newDuration: Duration): void => {
      setDuration(newDuration);
    },
    [setDuration],
  );

  /** Side Effects **/

  /* Load tokens list and initialize with DAI */
  useEffect(() => {
    if (!safeInfo) {
      return;
    }

    const tokenListRes: TokenItem[] = getTokenList(safeInfo.network);

    setTokenList(tokenListRes);

    const findDaiRes: TokenItem | undefined = tokenListRes.find(t => {
      return t.id === "DAI";
    });
    setSelectedToken(findDaiRes);
  }, [safeInfo]);

  /* Clear the form every time the user changes the token */
  useEffect(() => {
    if (!safeInfo?.network || !selectedToken) {
      return;
    }

    setTokenBalance("0");
    setStreamAmount("");
    setAmountError(undefined);

    const provider = new InfuraProvider(safeInfo.network, process.env.REACT_APP_INFURA_KEY);
    setTokenInstance(new Contract(selectedToken.address, erc20Abi, provider));
  }, [safeInfo, selectedToken]);

  useEffect(() => {
    const getData = async () => {
      if (!safeInfo || !selectedToken || !tokenInstance) {
        return;
      }

      /* Wait until token is correctly updated */
      if (selectedToken?.address.toLocaleLowerCase() !== tokenInstance?.address.toLocaleLowerCase()) {
        return;
      }

      /* Get token Balance */
      let newTokenBalance: string;
      if (selectedToken.id === "ETH") {
        newTokenBalance = parseEther(safeInfo.ethBalance).toString();
      } else {
        newTokenBalance = await tokenInstance.balanceOf(safeInfo.safeAddress);
      }

      /* Update all the values in a row to avoid UI flickers */
      setTokenBalance(newTokenBalance);
    };

    getData();
  }, [safeInfo, selectedToken, tokenInstance]);

  if (!selectedToken) {
    return <Loader size="md" />;
  }

  return (
    <>
      <Text size="lg">What token do you want to use?</Text>

      <SelectContainer>
        <Select items={tokenList || []} activeItemId={selectedToken.id} onItemClick={onSelectItem} />
        <Text size="lg">{humanTokenBalance()}</Text>
      </SelectContainer>

      <Text size="lg">How much do you want to stream in total?</Text>
      <SelectContainer>
        <BigNumberInput
          decimals={selectedToken.decimals}
          onChange={onAmountChange}
          value={streamAmount}
          renderInput={(props: any) => (
            <TextField label="Amount" value={props.value} onChange={props.onChange} meta={{ error: amountError }} />
          )}
        />
      </SelectContainer>

      <Text size="lg">Who would you like to stream to?</Text>

      <SelectContainer>
        <TextField label="Recipient" value={recipient} onChange={(event): void => setRecipient(event.target.value)} />
      </SelectContainer>

      <Text size="lg">For how long should the money be streamed?</Text>

      <DurationInput duration={duration} onUpdateDuration={onUpdateDuration} />

      <ButtonContainer>
        <Button size="lg" color="primary" variant="contained" onClick={createStream} disabled={isButtonDisabled()}>
          Create Stream
        </Button>
      </ButtonContainer>
    </>
  );
}

export default CreateStreamForm;
