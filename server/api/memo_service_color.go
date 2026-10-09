package api

import (
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	apipb "github.com/usememos/memos/proto/gen/api"
)

func validateMemoColor(color apipb.MemoColor) (string, error) {
	switch color {
	case apipb.MemoColor_MEMO_COLOR_UNSPECIFIED:
		return "", nil
	case apipb.MemoColor_MEMO_COLOR_LAVENDER,
		apipb.MemoColor_MEMO_COLOR_SAGE,
		apipb.MemoColor_MEMO_COLOR_SKY,
		apipb.MemoColor_MEMO_COLOR_AMBER,
		apipb.MemoColor_MEMO_COLOR_ROSE,
		apipb.MemoColor_MEMO_COLOR_PEACH:
		return color.String(), nil
	default:
		return "", status.Errorf(codes.InvalidArgument, "invalid memo color")
	}
}

func convertMemoColorFromStore(color string) apipb.MemoColor {
	value, ok := apipb.MemoColor_value[color]
	if !ok {
		return apipb.MemoColor_MEMO_COLOR_UNSPECIFIED
	}
	return apipb.MemoColor(value)
}
